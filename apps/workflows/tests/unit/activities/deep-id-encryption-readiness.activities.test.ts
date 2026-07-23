import { HttpError, type UsersPage } from '@reputo/deep-id-api';
import { ApplicationFailure } from '@temporalio/activity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE,
  DEEP_ID_ENCRYPTION_TIMEOUT_ERROR_TYPE,
} from '../../../src/shared/errors/index.js';

const { mockIterateUsers, mockCreateDeepIdClient, mockLog, mockHeartbeat } = vi.hoisted(() => {
  const iterate = vi.fn();
  return {
    mockIterateUsers: iterate,
    mockCreateDeepIdClient: vi.fn(() => ({ iterateUsers: iterate })),
    mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockHeartbeat: vi.fn(),
  };
});

// Keep the real schemas and errors, mock only the client factory.
vi.mock('@reputo/deep-id-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/deep-id-api')>();
  return { ...actual, createDeepIdClient: mockCreateDeepIdClient };
});

// Keep the real ApplicationFailure, mock only the activity context.
vi.mock('@temporalio/activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@temporalio/activity')>();
  return {
    ...actual,
    Context: { current: () => ({ log: mockLog, heartbeat: mockHeartbeat }) },
  };
});

vi.mock('../../../src/config/index.js', () => ({
  default: {
    app: { nodeEnv: 'production' },
    logger: { level: 'silent' },
    deepId: {
      identityBaseUrl: 'https://identity.test',
      appBaseUrl: 'https://app.test',
      clientId: 'cid',
      clientSecret: 'secret',
      scopes: 'api wallets post_scores',
      requestTimeoutMs: 1000,
      concurrency: 2,
      usersPageSize: 500,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
    },
  },
}));

import { createCheckEncryptionReadinessActivity } from '../../../src/activities/orchestrator/deep-id-encryption-readiness.activities.js';

const READINESS_SCOPES = 'api voting_engagement_encr token_value_over_time_encr';

const didFor = (i: number) => `did:sub:${String(i).padStart(24, '0')}`;

function child(key: string, weight = 1) {
  return { algorithm_key: key, algorithm_version: '1.0.0', weight, inputs: [] };
}

function makeInput(children: unknown[] = [child('voting_engagement'), child('token_value_over_time', 2)]) {
  return {
    snapshotId: 'snap-1',
    algorithmPresetFrozen: {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        { key: 'sub_algorithms', value: children },
      ],
    },
  } as never;
}

const encrypted = (ciphertext = 'CIPHERTEXT-BODY') => ({ status: 'encrypted', ciphertext });
const pendingEncryption = () => ({ status: 'pending_encryption', ciphertext: null });

function scoresEncr(fields: Record<string, unknown>, sealMetadata: string | null = '/v1/seal-metadata/key-1') {
  return { 'seal-metadata': sealMetadata, ...fields };
}

function user(fields?: Record<string, unknown>, sealMetadata: string | null = '/v1/seal-metadata/key-1') {
  return fields === undefined
    ? { scopes: ['api'] }
    : { scopes: ['api'], scores_encr: scoresEncr(fields, sealMetadata) };
}

function completeUser() {
  return user({ voting_engagement_encr: encrypted(), token_value_over_time_encr: encrypted() });
}

function pageOf(users: Record<string, unknown>, extras: Partial<UsersPage> = {}) {
  return { users, ...extras } as UsersPage;
}

/** Queues one iterateUsers call that yields the given pages, then ends. */
function enqueuePass(pages: UsersPage[]) {
  mockIterateUsers.mockImplementationOnce(async function* () {
    yield* pages;
  });
}

/** Queues one iterateUsers call that yields the given pages, then throws. */
function enqueueFailingPass(pages: UsersPage[], error: Error) {
  mockIterateUsers.mockImplementationOnce(async function* () {
    yield* pages;
    throw error;
  });
}

async function expectFatal(promise: Promise<unknown>): Promise<ApplicationFailure> {
  const error = await promise.then(
    () => {
      throw new Error('expected the readiness pass to fail');
    },
    (thrown) => thrown as unknown,
  );
  expect(error).toBeInstanceOf(ApplicationFailure);
  const failure = error as ApplicationFailure;
  expect(failure.nonRetryable).toBe(true);
  expect(failure.type).toBe(DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE);
  return failure;
}

describe('checkEncryptionReadiness activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests api plus exactly the selected children encrypted scopes with pageSize 1000', async () => {
    enqueuePass([pageOf({ [didFor(1)]: completeUser() })]);

    await createCheckEncryptionReadinessActivity()(makeInput());

    expect(mockCreateDeepIdClient).toHaveBeenCalledWith(expect.objectContaining({ scopes: READINESS_SCOPES }));
    expect(mockIterateUsers).toHaveBeenCalledWith({ pageSize: 1000, filteredTokenScopes: READINESS_SCOPES });
  });

  it('classifies complete, potentially complete, and incomplete users and is not ready while one is pending', async () => {
    enqueuePass([
      pageOf({
        [didFor(1)]: completeUser(),
        [didFor(2)]: user({ voting_engagement_encr: encrypted(), token_value_over_time_encr: pendingEncryption() }),
        [didFor(3)]: user({ voting_engagement_encr: encrypted(), token_value_over_time_encr: null }),
        [didFor(4)]: user({ voting_engagement_encr: encrypted() }),
        [didFor(5)]: user(),
      }),
    ]);

    const result = await createCheckEncryptionReadinessActivity()(makeInput());

    expect(result.ready).toBe(false);
    expect(result.counts).toEqual({ complete: 1, potentiallyComplete: 1, incomplete: 3 });
    expect(result.scannedUsers).toBe(5);
  });

  it('reports readiness when no potentially complete user remains; incomplete users never fail or zero-fill', async () => {
    enqueuePass([
      pageOf({
        [didFor(1)]: completeUser(),
        [didFor(2)]: user({ voting_engagement_encr: null, token_value_over_time_encr: encrypted() }),
      }),
    ]);

    const result = await createCheckEncryptionReadinessActivity()(makeInput());

    expect(result).toMatchObject({
      ready: true,
      counts: { complete: 1, potentiallyComplete: 0, incomplete: 1 },
      pages: 1,
      cursorRestarts: 0,
    });
  });

  it('treats a user whose native zeros were encrypted like any other complete user', async () => {
    // A native zero, once encrypted by DeepID, is a normal `encrypted` field.
    enqueuePass([pageOf({ [didFor(1)]: completeUser() })]);

    const result = await createCheckEncryptionReadinessActivity()(makeInput());

    expect(result.ready).toBe(true);
    expect(result.counts.complete).toBe(1);
  });

  it('scans every page, heartbeats per page, and keeps the last request id', async () => {
    enqueuePass([
      pageOf({ [didFor(1)]: completeUser() }, { next: 'cursor-2', requestId: 'req-1' }),
      pageOf({ [didFor(2)]: completeUser() }, { next: 'cursor-3' }),
      pageOf(
        { [didFor(3)]: user({ voting_engagement_encr: pendingEncryption(), token_value_over_time_encr: encrypted() }) },
        { requestId: 'req-3' },
      ),
    ]);

    const result = await createCheckEncryptionReadinessActivity()(makeInput());

    expect(result).toMatchObject({
      ready: false,
      counts: { complete: 2, potentiallyComplete: 1, incomplete: 0 },
      scannedUsers: 3,
      pages: 3,
      lastRequestId: 'req-3',
    });
    expect(mockHeartbeat).toHaveBeenCalledTimes(3);
    expect(mockHeartbeat).toHaveBeenLastCalledWith({ pages: 3, scannedUsers: 3 });
  });

  it('discards the partial pass on cursor expiry and restarts from page 1 without double-counting', async () => {
    enqueueFailingPass(
      [pageOf({ [didFor(1)]: completeUser(), [didFor(2)]: completeUser() }, { next: 'cursor-2', requestId: 'req-1' })],
      new HttpError(400, 'Bad Request'),
    );
    enqueuePass([
      pageOf({ [didFor(1)]: completeUser(), [didFor(2)]: completeUser() }, { next: 'cursor-2b' }),
      pageOf({ [didFor(3)]: completeUser() }, { requestId: 'req-2' }),
    ]);

    const result = await createCheckEncryptionReadinessActivity()(makeInput());

    expect(mockIterateUsers).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ready: true,
      counts: { complete: 3, potentiallyComplete: 0, incomplete: 0 },
      scannedUsers: 3,
      pages: 2,
      cursorRestarts: 1,
      lastRequestId: 'req-2',
    });
  });

  it('fails clearly and non-retryably when the cursor keeps expiring past the restart bound', async () => {
    mockIterateUsers.mockImplementation(async function* () {
      yield pageOf({ [didFor(1)]: completeUser() }, { next: 'cursor-2', requestId: 'req-9' });
      throw new HttpError(400, 'Bad Request');
    });

    const failure = await expectFatal(createCheckEncryptionReadinessActivity()(makeInput()));

    expect(failure.message).toContain('cursor expired on 4 consecutive passes');
    // The initial pass plus the three bounded restarts.
    expect(mockIterateUsers).toHaveBeenCalledTimes(4);
  });

  it('treats a 400 on the first page as fatal, not as cursor expiry', async () => {
    enqueueFailingPass([], new HttpError(400, 'Bad Request'));

    const failure = await expectFatal(createCheckEncryptionReadinessActivity()(makeInput()));

    expect(failure.message).toContain('HTTP 400');
    expect(mockIterateUsers).toHaveBeenCalledTimes(1);
  });

  it('fails non-retryably on an authentication failure', async () => {
    enqueueFailingPass([], new HttpError(401, 'Unauthorized'));

    const failure = await expectFatal(createCheckEncryptionReadinessActivity()(makeInput()));

    expect(failure.message).toContain('authentication failed');
  });

  it('rethrows transient server errors unchanged so Temporal can retry the poll', async () => {
    const serverError = new HttpError(503, 'Service Unavailable');
    enqueueFailingPass([pageOf({ [didFor(1)]: completeUser() })], serverError);

    await expect(createCheckEncryptionReadinessActivity()(makeInput())).rejects.toBe(serverError);
  });

  it('fails immediately for a malformed encryption status', async () => {
    enqueuePass([
      pageOf({
        [didFor(1)]: user({ voting_engagement_encr: { status: 'exploded', ciphertext: 'x' } }),
        [didFor(2)]: completeUser(),
      }),
    ]);

    const failure = await expectFatal(createCheckEncryptionReadinessActivity()(makeInput()));

    expect(failure.message).toContain(didFor(1));
    expect(failure.message).toContain('malformed scores_encr');
  });

  it('fails immediately when a ready field carries no ciphertext', async () => {
    enqueuePass([pageOf({ [didFor(1)]: user({ voting_engagement_encr: { status: 'encrypted', ciphertext: '' } }) })]);

    const failure = await expectFatal(createCheckEncryptionReadinessActivity()(makeInput()));

    expect(failure.message).toContain('malformed scores_encr');
  });

  it('fails immediately when a complete user has no seal-metadata reference', async () => {
    enqueuePass([
      pageOf({
        [didFor(1)]: user({ voting_engagement_encr: encrypted(), token_value_over_time_encr: encrypted() }, null),
      }),
    ]);

    const failure = await expectFatal(createCheckEncryptionReadinessActivity()(makeInput()));

    expect(failure.message).toContain('seal-metadata');
  });

  it('fails non-retryably when a selected child has no encrypted scope', async () => {
    enqueuePass([pageOf({})]);

    const failure = await expectFatal(createCheckEncryptionReadinessActivity()(makeInput([child('bogus_child')])));

    expect(failure.message).toContain('bogus_child');
    expect(mockIterateUsers).not.toHaveBeenCalled();
  });

  it('returns only aggregate data: no ciphertext or DID ever leaves the pass', async () => {
    enqueuePass([
      pageOf({
        [didFor(1)]: completeUser(),
        [didFor(2)]: user({ voting_engagement_encr: encrypted(), token_value_over_time_encr: pendingEncryption() }),
      }),
    ]);

    const result = await createCheckEncryptionReadinessActivity()(makeInput());

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('CIPHERTEXT-BODY');
    expect(serialized).not.toContain('did:sub:');
  });

  it('exposes distinct error types for the fatal pass and the workflow deadline', () => {
    expect(DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE).not.toBe(DEEP_ID_ENCRYPTION_TIMEOUT_ERROR_TYPE);
  });
});

import { DeepIdContractError, HttpError, type SealMetadata, type UsersPage } from '@reputo/deep-id-api';
import { ApplicationFailure } from '@temporalio/activity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEEP_ID_ENCRYPTED_SUBMISSION_FATAL_ERROR_TYPE,
  EncryptedCustomScoreError,
} from '../../../src/shared/errors/index.js';
import type { EncryptedScoresSubmittedResult } from '../../../src/shared/types/index.js';

const { mockIterateUsers, mockPostScores, mockGetSealMetadata, mockCreateDeepIdClient, mockLog, mockHeartbeat } =
  vi.hoisted(() => {
    const iterate = vi.fn();
    const post = vi.fn();
    const metadata = vi.fn();
    return {
      mockIterateUsers: iterate,
      mockPostScores: post,
      mockGetSealMetadata: metadata,
      mockCreateDeepIdClient: vi.fn(() => ({
        iterateUsers: iterate,
        postScores: post,
        getSealMetadata: metadata,
      })),
      mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      mockHeartbeat: vi.fn(),
    };
  });

const { evaluatorState, mockCreateEvaluator } = vi.hoisted(() => {
  const state = {
    createInputs: [] as unknown[],
    registered: [] as string[],
    batches: [] as Array<
      Array<{
        did: string;
        keyId: string;
        ciphertexts: Record<string, string>;
      }>
    >,
    disposed: 0,
    /** When set, the next evaluateBatch call throws it (then clears). */
    failNextBatch: null as Error | null,
  };
  return {
    evaluatorState: state,
    mockCreateEvaluator: vi.fn(async (input: unknown) => {
      state.createInputs.push(input);
      return {
        registerSealMetadata: (metadata: { id: string }) => {
          state.registered.push(metadata.id);
        },
        hasKey: (keyId: string) => state.registered.includes(keyId),
        evaluateUser: vi.fn(),
        evaluateBatch: (
          users: Array<{
            did: string;
            keyId: string;
            ciphertexts: Record<string, string>;
          }>,
        ) => {
          if (state.failNextBatch) {
            const error = state.failNextBatch;
            state.failNextBatch = null;
            throw error;
          }
          state.batches.push(users.map((user) => ({ ...user })));
          return users.map((user) => ({
            did: user.did,
            keyId: user.keyId,
            ciphertext: `ENC(${user.did})`,
          }));
        },
        stats: () => ({
          registeredKeys: new Set(state.registered).size,
          liveHandles: 0,
        }),
        dispose: () => {
          state.disposed += 1;
        },
      };
    }),
  };
});

// Keep the real schemas, chunk, and errors; mock only the client factory.
vi.mock('@reputo/deep-id-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/deep-id-api')>();
  return { ...actual, createDeepIdClient: mockCreateDeepIdClient };
});

// The evaluator's CKKS math has its own suite; here it is a recording stub.
vi.mock('../../../src/activities/typescript/algorithms/custom-score/encrypted-evaluator/index.js', () => ({
  createEncryptedCustomScoreEvaluator: mockCreateEvaluator,
}));

// Keep the real ApplicationFailure, mock only the activity context.
vi.mock('@temporalio/activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@temporalio/activity')>();
  return {
    ...actual,
    Context: {
      current: () => ({ log: mockLog, heartbeat: mockHeartbeat }),
    },
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

import { createSubmitCustomEncryptedScoresActivity } from '../../../src/activities/orchestrator/deep-id-submit-encrypted-scores.activities.js';

const TIMESTAMP = '2026-07-22T10:00:00.000Z';
const SELECTED_SCOPES = 'api voting_engagement_encr token_value_over_time_encr';
const METADATA_URL = '/v1/seal-metadata/key-1';

const didFor = (i: number) => `did:sub:${String(i).padStart(24, '0')}`;

function child(key: string, weight = 1) {
  return {
    algorithm_key: key,
    algorithm_version: '1.0.0',
    weight,
    inputs: [],
  };
}

const OBSERVATIONS = [
  {
    scoreType: 'voting_engagement',
    observation: { method: 'observed_min_max', min: 0, max: 10 },
  },
  {
    scoreType: 'token_value_over_time',
    observation: { method: 'observed_min_max', min: 5, max: 25 },
  },
];

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: 'snap-1',
    algorithmPresetFrozen: {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        {
          key: 'sub_algorithms',
          value: [child('voting_engagement'), child('token_value_over_time', 2)],
        },
      ],
    },
    observations: OBSERVATIONS,
    timestamp: TIMESTAMP,
    ...overrides,
  } as never;
}

const encrypted = (ciphertext = 'CIPHERTEXT-BODY') => ({
  status: 'encrypted',
  ciphertext,
});
const pendingEncryption = () => ({
  status: 'pending_encryption',
  ciphertext: null,
});

function user(fields?: Record<string, unknown>, sealMetadata: string | null = METADATA_URL) {
  return fields === undefined
    ? { scopes: ['api'] }
    : {
        scopes: ['api'],
        scores_encr: { 'seal-metadata': sealMetadata, ...fields },
      };
}

function completeUser(sealMetadata: string | null = METADATA_URL) {
  return user(
    {
      voting_engagement_encr: encrypted('CT-VOTING'),
      token_value_over_time_encr: encrypted('CT-TOKEN'),
    },
    sealMetadata,
  );
}

function pendingUser() {
  return user({
    voting_engagement_encr: encrypted(),
    token_value_over_time_encr: pendingEncryption(),
  });
}

function pageOf(users: Record<string, unknown>, extras: Partial<UsersPage> = {}) {
  return { users, ...extras } as UsersPage;
}

function completePage(from: number, count: number, extras: Partial<UsersPage> = {}) {
  return pageOf(
    Object.fromEntries(Array.from({ length: count }, (_, i) => [didFor(from + i), completeUser()])),
    extras,
  );
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

function sealMetadata(id: string): SealMetadata {
  return {
    id,
    schemeType: 'ckks',
    securityLevel: 128,
    polyModulusDegree: 8192,
    coeffModulusBitSizes: [60, 40, 60],
    scale: 2 ** 40,
    encryptionParameters: `PARAMS-${id}`,
  };
}

function okResponse(request: Record<string, unknown>, requestId?: string) {
  const dids = Object.keys(request);
  return {
    status: { ok: dids.length, failed: 0 },
    results: Object.fromEntries(dids.map((did) => [did, { message: 'OK' }])),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

async function expectFatal(promise: Promise<unknown>): Promise<ApplicationFailure> {
  const error = await promise.then(
    () => {
      throw new Error('expected the encrypted submission to fail');
    },
    (thrown) => thrown as unknown,
  );
  expect(error).toBeInstanceOf(ApplicationFailure);
  const failure = error as ApplicationFailure;
  expect(failure.nonRetryable).toBe(true);
  expect(failure.type).toBe(DEEP_ID_ENCRYPTED_SUBMISSION_FATAL_ERROR_TYPE);
  return failure;
}

describe('submitCustomEncryptedScores activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluatorState.createInputs = [];
    evaluatorState.registered = [];
    evaluatorState.batches = [];
    evaluatorState.disposed = 0;
    evaluatorState.failNextBatch = null;
    mockPostScores.mockImplementation(async (request: Record<string, unknown>) => okResponse(request));
    mockGetSealMetadata.mockImplementation(async (url: string) => sealMetadata(url.split('/').pop() as string));
  });

  it('evaluates complete users page by page and posts bounded custom_score_encr batches under the fixed timestamp', async () => {
    enqueuePass([
      completePage(1, 30, { next: 'cursor-2', requestId: 'req-1' }),
      completePage(31, 10, { requestId: 'req-2' }),
    ]);
    mockPostScores.mockImplementation(async (request: Record<string, unknown>) => okResponse(request, 'req-post'));

    const result = (await createSubmitCustomEncryptedScoresActivity()(makeInput())) as EncryptedScoresSubmittedResult;

    expect(mockCreateDeepIdClient).toHaveBeenCalledWith(expect.objectContaining({ scopes: SELECTED_SCOPES }));
    expect(mockIterateUsers).toHaveBeenCalledWith({
      pageSize: 100,
      filteredTokenScopes: SELECTED_SCOPES,
    });

    // One evaluation batch per page, complete users only, ciphertexts keyed by child.
    expect(evaluatorState.batches).toHaveLength(2);
    expect(evaluatorState.batches[0]).toHaveLength(30);
    expect(evaluatorState.batches[1]).toHaveLength(10);
    expect(evaluatorState.batches[0][0]).toEqual({
      did: didFor(1),
      keyId: 'key-1',
      ciphertexts: {
        voting_engagement: 'CT-VOTING',
        token_value_over_time: 'CT-TOKEN',
      },
    });

    // 30 → 25 + 5, then 10: three bounded batches, every entry OK.
    expect(mockPostScores).toHaveBeenCalledTimes(3);
    const batchSizes = mockPostScores.mock.calls.map(([request]) => Object.keys(request as object).length);
    expect(batchSizes).toEqual([25, 5, 10]);
    const firstBatch = mockPostScores.mock.calls[0][0] as Record<string, unknown>;
    expect(firstBatch[didFor(1)]).toEqual({
      ciphertext: `ENC(${didFor(1)})`,
      keyId: 'key-1',
      type: 'custom_score_encr',
      timestamp: TIMESTAMP,
    });

    // Metadata is fetched once per URL and registered once for the whole pass.
    expect(mockGetSealMetadata).toHaveBeenCalledTimes(1);
    expect(mockGetSealMetadata).toHaveBeenCalledWith(METADATA_URL);
    expect(evaluatorState.registered).toEqual(['key-1']);

    expect(result).toMatchObject({
      outcome: 'submitted',
      complete: 40,
      incomplete: 0,
      scannedUsers: 40,
      pages: 2,
      cursorRestarts: 0,
      submitted: 40,
      batches: 3,
      registeredKeys: 1,
      lastRequestId: 'req-post',
    });
    expect(evaluatorState.disposed).toBe(1);

    expect(mockHeartbeat.mock.calls[0][0]).toEqual({
      pages: 1,
      scannedUsers: 0,
      submitted: 0,
    });
    const metadataOrder = mockGetSealMetadata.mock.invocationCallOrder[0];
    const firstPostOrder = mockPostScores.mock.invocationCallOrder[0];
    expect(
      mockHeartbeat.mock.invocationCallOrder.some((order) => order > metadataOrder && order < firstPostOrder),
    ).toBe(true);
  });

  it('passes the resolved method and per-child observations to the evaluator', async () => {
    enqueuePass([completePage(1, 1)]);

    await createSubmitCustomEncryptedScoresActivity()(makeInput());

    expect(mockCreateEvaluator).toHaveBeenCalledTimes(1);
    expect(evaluatorState.createInputs[0]).toEqual({
      method: 'observed_min_max',
      children: [
        {
          key: 'voting_engagement',
          weight: 1,
          observation: {
            method: 'observed_min_max',
            min: 0,
            max: 10,
          },
        },
        {
          key: 'token_value_over_time',
          weight: 2,
          observation: {
            method: 'observed_min_max',
            min: 5,
            max: 25,
          },
        },
      ],
    });
  });

  it('preserves unified DIDs verbatim and echoes each user metadata key id', async () => {
    const didA = 'did:sub:aAbBcCdDeEfFgGhHiIjJkKlL';
    const didB = didFor(2);
    enqueuePass([
      pageOf(
        {
          [didA]: completeUser(),
          [didB]: completeUser('/v1/seal-metadata/key-2'),
        },
        { requestId: 'req-1' },
      ),
    ]);

    const result = (await createSubmitCustomEncryptedScoresActivity()(makeInput())) as EncryptedScoresSubmittedResult;

    const request = mockPostScores.mock.calls[0][0] as Record<string, { keyId: string }>;
    expect(Object.keys(request)).toEqual([didA, didB]);
    expect(request[didA].keyId).toBe('key-1');
    expect(request[didB].keyId).toBe('key-2');
    expect(mockGetSealMetadata).toHaveBeenCalledTimes(2);
    expect(result.registeredKeys).toBe(2);
  });

  it('excludes incomplete users without zero-filling and still submits the complete ones', async () => {
    enqueuePass([
      pageOf({
        [didFor(1)]: completeUser(),
        [didFor(2)]: user({
          voting_engagement_encr: encrypted(),
          token_value_over_time_encr: null,
        }),
        [didFor(3)]: user({ voting_engagement_encr: encrypted() }),
        [didFor(4)]: user(),
      }),
    ]);

    const result = (await createSubmitCustomEncryptedScoresActivity()(makeInput())) as EncryptedScoresSubmittedResult;

    expect(result).toMatchObject({
      outcome: 'submitted',
      complete: 1,
      incomplete: 3,
      scannedUsers: 4,
      submitted: 1,
    });
    expect(evaluatorState.batches).toHaveLength(1);
    expect(evaluatorState.batches[0].map((entry) => entry.did)).toEqual([didFor(1)]);
    const request = mockPostScores.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(request)).toEqual([didFor(1)]);
  });

  it('stops the page and returns pending_encryption when a potentially complete user is still pending', async () => {
    enqueuePass([
      completePage(1, 2, { next: 'cursor-2' }),
      pageOf({
        [didFor(3)]: completeUser(),
        [didFor(4)]: pendingUser(),
        [didFor(5)]: completeUser(),
      }),
    ]);

    const result = await createSubmitCustomEncryptedScoresActivity()(makeInput());

    // Page 1 was already submitted — its entries are safely reposted later —
    // but the pending user's page is never evaluated or posted.
    expect(evaluatorState.batches).toHaveLength(1);
    expect(mockPostScores).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: 'pending_encryption',
      complete: 3,
      incomplete: 0,
      scannedUsers: 4,
      pages: 2,
      cursorRestarts: 0,
    });
    expect(evaluatorState.disposed).toBe(1);
  });

  it('submits nothing at all when the pending user appears before any complete page', async () => {
    enqueuePass([pageOf({ [didFor(1)]: pendingUser(), [didFor(2)]: completeUser() })]);

    const result = await createSubmitCustomEncryptedScoresActivity()(makeInput());

    expect(result).toMatchObject({
      outcome: 'pending_encryption',
      pages: 1,
    });
    expect(evaluatorState.batches).toHaveLength(0);
    expect(mockPostScores).not.toHaveBeenCalled();
  });

  it('discards page-local state on cursor expiry and restarts from page 1 with idempotent reposts', async () => {
    enqueueFailingPass(
      [completePage(1, 2, { next: 'cursor-2', requestId: 'req-1' })],
      new HttpError(400, 'Bad Request'),
    );
    enqueuePass([completePage(1, 2, { next: 'cursor-2b' }), completePage(3, 1, { requestId: 'req-2' })]);

    const result = (await createSubmitCustomEncryptedScoresActivity()(makeInput())) as EncryptedScoresSubmittedResult;

    expect(mockIterateUsers).toHaveBeenCalledTimes(2);
    // The first pass posted page 1 before the cursor expired; the restarted
    // pass reposts the same logical entries and counts users exactly once.
    expect(mockPostScores).toHaveBeenCalledTimes(3);
    expect(Object.keys(mockPostScores.mock.calls[0][0] as object)).toEqual([didFor(1), didFor(2)]);
    expect(Object.keys(mockPostScores.mock.calls[1][0] as object)).toEqual([didFor(1), didFor(2)]);
    expect(result).toMatchObject({
      outcome: 'submitted',
      complete: 3,
      scannedUsers: 3,
      pages: 2,
      cursorRestarts: 1,
      submitted: 3,
      lastRequestId: 'req-2',
    });
  });

  it('fails clearly and non-retryably when the cursor keeps expiring past the restart bound', async () => {
    mockIterateUsers.mockImplementation(async function* () {
      yield completePage(1, 1, { next: 'cursor-2', requestId: 'req-9' });
      throw new HttpError(400, 'Bad Request');
    });

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('cursor expired on 4 consecutive passes');
    // The initial pass plus the three bounded restarts.
    expect(mockIterateUsers).toHaveBeenCalledTimes(4);
    expect(evaluatorState.disposed).toBe(1);
  });

  it('treats a 400 on the first page as fatal, not as cursor expiry', async () => {
    enqueueFailingPass([], new HttpError(400, 'Bad Request'));

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('HTTP 400');
    expect(mockIterateUsers).toHaveBeenCalledTimes(1);
  });

  it('treats a 400 from the final post as fatal instead of restarting the pass', async () => {
    enqueuePass([completePage(1, 2, { next: 'cursor-2' }), completePage(3, 1)]);
    mockPostScores.mockRejectedValue(new HttpError(400, 'Bad Request'));

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('HTTP 400');
    expect(mockIterateUsers).toHaveBeenCalledTimes(1);
  });

  it('fails the run when DeepID rejects a final entry for a complete user', async () => {
    enqueuePass([completePage(1, 2)]);
    mockPostScores.mockImplementation(async (request: Record<string, unknown>) => {
      const response = okResponse(request, 'req-1');
      response.results[didFor(2)] = { message: 'User not found' };
      return response;
    });

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('rejected the final custom_score_encr entry');
    expect(failure.message).toContain('User not found');
    expect(evaluatorState.disposed).toBe(1);
  });

  it('treats a missing per-user result in a partial DeepID response as a rejection', async () => {
    enqueuePass([completePage(1, 2)]);
    mockPostScores.mockImplementation(async (request: Record<string, unknown>) => {
      const response = okResponse(request);
      delete response.results[didFor(2)];
      return response;
    });

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('no per-user result returned');
  });

  it('rethrows transient server errors unchanged so Temporal can retry the whole pass', async () => {
    const serverError = new HttpError(503, 'Service Unavailable');
    enqueuePass([completePage(1, 1)]);
    mockPostScores.mockRejectedValue(serverError);

    await expect(createSubmitCustomEncryptedScoresActivity()(makeInput())).rejects.toBe(serverError);
    expect(evaluatorState.disposed).toBe(1);
  });

  it('fails non-retryably on an authentication failure', async () => {
    enqueueFailingPass([], new HttpError(401, 'Unauthorized'));

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('authentication failed');
  });

  it('converts an evaluator failure into a fatal submission failure', async () => {
    enqueuePass([completePage(1, 1)]);
    evaluatorState.failNextBatch = new EncryptedCustomScoreError(
      'ciphertext is from another key',
      'INCOMPATIBLE_CIPHERTEXT',
      {
        did: didFor(1),
      },
    );

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('Encrypted custom_score evaluation failed');
    expect(failure.message).toContain('ciphertext is from another key');
    expect(mockPostScores).not.toHaveBeenCalled();
    expect(evaluatorState.disposed).toBe(1);
  });

  it('fails immediately for malformed scores_encr', async () => {
    enqueuePass([
      pageOf({
        [didFor(1)]: user({
          voting_engagement_encr: {
            status: 'exploded',
            ciphertext: 'x',
          },
        }),
      }),
    ]);

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('malformed scores_encr');
    expect(evaluatorState.disposed).toBe(1);
  });

  it('fails immediately when a complete user has no seal-metadata reference', async () => {
    enqueuePass([pageOf({ [didFor(1)]: completeUser(null) })]);

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('seal-metadata');
  });

  it('fails fatally when the referenced seal metadata breaks the contract', async () => {
    enqueuePass([completePage(1, 1)]);
    mockGetSealMetadata.mockRejectedValue(new DeepIdContractError('malformed seal metadata response'));

    const failure = await expectFatal(createSubmitCustomEncryptedScoresActivity()(makeInput()));

    expect(failure.message).toContain('broke the contract');
    expect(mockPostScores).not.toHaveBeenCalled();
  });

  it('fails before reading users when a selected child has no observation from the raw submission', async () => {
    const failure = await expectFatal(
      createSubmitCustomEncryptedScoresActivity()(makeInput({ observations: [OBSERVATIONS[0]] })),
    );

    expect(failure.message).toContain('token_value_over_time');
    expect(failure.message).toContain('no normalization observation');
    expect(mockIterateUsers).not.toHaveBeenCalled();
  });

  it('fails non-retryably when a selected child has no encrypted scope', async () => {
    const failure = await expectFatal(
      createSubmitCustomEncryptedScoresActivity()(
        makeInput({
          algorithmPresetFrozen: {
            key: 'custom_score',
            version: '1.0.0',
            inputs: [
              {
                key: 'sub_algorithms',
                value: [child('bogus_child')],
              },
            ],
          },
        }),
      ),
    );

    expect(failure.message).toContain('bogus_child');
    expect(mockIterateUsers).not.toHaveBeenCalled();
  });
});

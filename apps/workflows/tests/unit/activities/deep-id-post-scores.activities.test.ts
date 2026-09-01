import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPostScores, mockCreateDeepIdClient, mockLog } = vi.hoisted(() => {
  const post = vi.fn();
  return {
    mockPostScores: post,
    mockCreateDeepIdClient: vi.fn(() => ({ postScores: post })),
    mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

// Keep the real isValidDid / chunk, mock only the client factory.
vi.mock('@reputo/deep-id-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/deep-id-api')>();
  return { ...actual, createDeepIdClient: mockCreateDeepIdClient };
});

// Keep the real registry, add a synthetic non-DeepID standalone algorithm.
vi.mock('@reputo/reputation-algorithms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/reputation-algorithms')>();
  return {
    ...actual,
    getAlgorithmDefinition: (input: { key: string; version?: string }) => {
      if (input.key === 'deepfunding_sync') {
        return JSON.stringify({
          key: 'deepfunding_sync',
          version: '1.0.0',
          kind: 'standalone',
          runtime: 'typescript',
          inputs: [],
          outputs: [{ key: 'deepfunding_sync', type: 'csv', csv: { columns: [{ key: 'did' }, { key: 'score' }] } }],
        });
      }
      return actual.getAlgorithmDefinition(input);
    },
  };
});

vi.mock('@temporalio/activity', async (importOriginal) => ({
  Context: {
    current: () => ({ log: mockLog, heartbeat: vi.fn() }),
  },
  // The real class: the activity converts every failure into a sanitized one.
  ApplicationFailure: (await importOriginal<typeof import('@temporalio/activity')>()).ApplicationFailure,
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    logger: { level: 'silent' },
    storage: { bucket: 'reputo' },
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

import { createDeepIdPostScoresActivity } from '../../../src/activities/orchestrator/deep-id-post-scores.activities.js';

const DID_A = 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa';
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const DID_C = 'did:sub:cccccccccccccccccccccccc';

const didFor = (i: number) => `did:sub:${String(i).padStart(24, '0')}`;

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snap-1',
    completedAt: '2026-06-12T10:00:00.000Z',
    algorithmPresetFrozen: { key: 'voting_engagement', version: '1.0.0', inputs: [] },
    outputs: { voting_engagement: 'snapshots/snap-1/voting_engagement.csv' },
    ...overrides,
  } as never;
}

function makeCombinedSnapshot(overrides: Record<string, unknown> = {}) {
  return makeSnapshot({
    algorithmPresetFrozen: {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        {
          key: 'sub_algorithms',
          value: [
            { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] },
            { algorithm_key: 'token_value_over_time', algorithm_version: '1.0.0', weight: 3, inputs: [] },
          ],
        },
      ],
    },
    outputs: {
      voting_engagement: 'snapshots/snap-1/voting_engagement.csv',
      token_value_over_time: 'snapshots/snap-1/token_value_over_time.csv',
      custom_score_details: 'snapshots/snap-1/custom_score_details.json',
    },
    ...overrides,
  });
}

function makeActivity(csv: string) {
  const getObject = vi.fn().mockResolvedValue(Buffer.from(csv, 'utf8'));
  return createDeepIdPostScoresActivity({
    storage: { getObject } as never,
    storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
  });
}

function rejectionWarns() {
  return mockLog.warn.mock.calls.filter(([message]) => message === 'DeepID rejected a score');
}

describe('createDeepIdPostScoresActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts only DID-keyed rows verbatim with type=algorithm key, falling back to the completedAt timestamp', async () => {
    const csv = [
      'did,voting_engagement',
      `${DID_A},0.8`,
      'not-a-did,0.5',
      'did:sub:cccccccccccccccccccccccc,not-a-number',
    ].join('\n');

    mockPostScores.mockResolvedValue({ status: { ok: 1, failed: 0 }, results: { [DID_A]: { message: 'OK' } } });

    const result = await makeActivity(csv)({ snapshot: makeSnapshot() });

    expect(result).toEqual({ attempted: true, posted: 1, ok: 1, failed: 0, dropped: 0, skipped: 2 });
    expect(mockPostScores).toHaveBeenCalledWith({
      [DID_A]: { score: 0.8, type: 'voting_engagement', timestamp: '2026-06-12T10:00:00.000Z' },
    });
  });

  it('prefers the workflow-provided run timestamp so retried posts dedupe on DeepID', async () => {
    const csv = ['did,voting_engagement', `${DID_A},0.8`].join('\n');

    mockPostScores.mockResolvedValue({ status: { ok: 1, failed: 0 }, results: { [DID_A]: { message: 'OK' } } });

    await makeActivity(csv)({ snapshot: makeSnapshot(), timestamp: '2026-06-12T09:00:00.000Z' });

    expect(mockPostScores).toHaveBeenCalledWith({
      [DID_A]: { score: 0.8, type: 'voting_engagement', timestamp: '2026-06-12T09:00:00.000Z' },
    });
  });

  it('posts a github_engagement snapshot under its own score type, explicit zeros included', async () => {
    const csv = ['did,github_engagement,pull_request_opened_points', `${DID_A},51.5,30`, `${DID_C},0,0`].join('\n');

    mockPostScores.mockResolvedValue({
      status: { ok: 2, failed: 0 },
      results: { [DID_A]: { message: 'OK' }, [DID_C]: { message: 'OK' } },
    });

    const result = await makeActivity(csv)({
      snapshot: makeSnapshot({
        algorithmPresetFrozen: { key: 'github_engagement', version: '1.0.0', inputs: [] },
        outputs: { github_engagement: 'snapshots/snap-1/github_engagement.csv' },
      }),
      timestamp: '2026-06-12T09:00:00.000Z',
    });

    expect(result).toEqual({ attempted: true, posted: 2, ok: 2, failed: 0, dropped: 0, skipped: 0 });
    expect(mockPostScores).toHaveBeenCalledWith({
      [DID_A]: { score: 51.5, type: 'github_engagement', timestamp: '2026-06-12T09:00:00.000Z' },
      [DID_C]: { score: 0, type: 'github_engagement', timestamp: '2026-06-12T09:00:00.000Z' },
    });
  });

  it('skips when the algorithm key is not a DeepID score type', async () => {
    const getObject = vi.fn();
    const activity = createDeepIdPostScoresActivity({
      storage: { getObject } as never,
      storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
    });

    const result = await activity({
      snapshot: makeSnapshot({ algorithmPresetFrozen: { key: 'deepfunding_sync', version: '1.0.0', inputs: [] } }),
    });

    expect(result).toEqual({ attempted: false, posted: 0, ok: 0, failed: 0, dropped: 0, skipped: 0 });
    expect(getObject).not.toHaveBeenCalled();
    expect(mockPostScores).not.toHaveBeenCalled();
  });

  it('skips a combined snapshot: the custom raw-score path owns its submission', async () => {
    const getObject = vi.fn();
    const activity = createDeepIdPostScoresActivity({
      storage: { getObject } as never,
      storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
    });

    const result = await activity({ snapshot: makeCombinedSnapshot() });

    expect(result).toEqual({ attempted: false, posted: 0, ok: 0, failed: 0, dropped: 0, skipped: 0 });
    expect(getObject).not.toHaveBeenCalled();
    expect(mockPostScores).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(
      'Combined snapshot scores are submitted by the custom raw-score path; skipping score post',
      { snapshotId: 'snap-1' },
    );
  });

  it('splits more than 500 entries into sequential chunked posts', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => `${didFor(i)},${i / 1000}`);
    const csv = ['did,voting_engagement', ...rows].join('\n');

    mockPostScores.mockImplementation(async (batch: Record<string, unknown>) => {
      const dids = Object.keys(batch);
      return {
        status: { ok: dids.length, failed: 0 },
        results: Object.fromEntries(dids.map((did) => [did, { message: 'OK' }])),
      };
    });

    const result = await makeActivity(csv)({ snapshot: makeSnapshot() });

    expect(mockPostScores).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockPostScores.mock.calls[0][0] as object)).toHaveLength(500);
    expect(Object.keys(mockPostScores.mock.calls[1][0] as object)).toHaveLength(1);
    expect(result).toEqual({ attempted: true, posted: 501, ok: 501, failed: 0, dropped: 0, skipped: 0 });
  });

  it('counts "User not found" as an expected drop and warns only on unexpected rejections', async () => {
    const csv = ['did,voting_engagement', `${DID_A},0.8`, `${DID_B},0.6`, `${DID_C},0.4`].join('\n');

    mockPostScores.mockResolvedValue({
      status: { ok: 1, failed: 2 },
      results: {
        [DID_A]: { message: 'OK' },
        [DID_B]: { message: 'User not found' },
        [DID_C]: { message: 'Invalid score type' },
      },
    });

    const result = await makeActivity(csv)({ snapshot: makeSnapshot() });

    expect(result).toEqual({ attempted: true, posted: 3, ok: 1, failed: 1, dropped: 1, skipped: 0 });
    const warns = rejectionWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toMatchObject({ did: DID_C, message: 'Invalid score type' });
  });

  it('caps per-DID rejection warns at 20 and logs one summary for the rest', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => `${didFor(i)},0.5`);
    const csv = ['did,voting_engagement', ...rows].join('\n');

    mockPostScores.mockImplementation(async (batch: Record<string, unknown>) => {
      const dids = Object.keys(batch);
      return {
        status: { ok: 0, failed: dids.length },
        results: Object.fromEntries(dids.map((did) => [did, { message: 'Boom' }])),
      };
    });

    const result = await makeActivity(csv)({ snapshot: makeSnapshot() });

    expect(result).toEqual({ attempted: true, posted: 25, ok: 0, failed: 25, dropped: 0, skipped: 0 });
    expect(rejectionWarns()).toHaveLength(20);
    const summaryWarns = mockLog.warn.mock.calls.filter(
      ([message]) => message === 'Further unexpected DeepID rejections were not logged individually',
    );
    expect(summaryWarns).toHaveLength(1);
    expect(summaryWarns[0][1]).toMatchObject({ failed: 25, logged: 20 });
  });

  it('never lets a DeepID response body cross the activity boundary', async () => {
    const csv = ['did,voting_engagement', `${DID_A},0.8`].join('\n');
    const secret = 'internal trace token=super-secret-value';
    const { HttpError } = await import('@reputo/deep-id-api');
    mockPostScores.mockRejectedValue(new HttpError(500, 'Internal Server Error', JSON.stringify({ message: secret })));

    const failure = await makeActivity(csv)({ snapshot: makeSnapshot() }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    const serialized = JSON.stringify({
      message: (failure as Error).message,
      stack: (failure as Error).stack,
      cause: (failure as Error).cause,
    });
    expect(serialized).not.toContain('super-secret-value');
    expect((failure as Error).message).toBe('DeepID score posting failed: upstream_error');
  });

  it.each([
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [429, 'rate_limited'],
    [400, 'rejected'],
    [503, 'upstream_error'],
  ])('maps a %i response to the %s category', async (statusCode, category) => {
    const csv = ['did,voting_engagement', `${DID_A},0.8`].join('\n');
    const { HttpError } = await import('@reputo/deep-id-api');
    mockPostScores.mockRejectedValue(new HttpError(statusCode, 'nope', 'body'));

    const failure = await makeActivity(csv)({ snapshot: makeSnapshot() }).catch((error: Error) => error);

    expect((failure as Error).message).toBe(`DeepID score posting failed: ${category}`);
  });

  it('reports an unreadable score output as its own category', async () => {
    const { ObjectNotFoundError } = await import('@reputo/storage');
    const getObject = vi.fn().mockRejectedValue(new ObjectNotFoundError('snapshots/snap-1/voting_engagement.csv'));
    const activity = createDeepIdPostScoresActivity({
      storage: { getObject } as never,
      storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
    });

    const failure = await activity({ snapshot: makeSnapshot() }).catch((error: Error) => error);

    expect((failure as Error).message).toBe('DeepID score posting failed: output_unreadable');
  });

  it('skips empty score cells but still posts literal zeros', async () => {
    const csv = ['did,voting_engagement', `${DID_A},0`, `${DID_B},`].join('\n');

    mockPostScores.mockResolvedValue({ status: { ok: 1, failed: 0 }, results: { [DID_A]: { message: 'OK' } } });

    const result = await makeActivity(csv)({ snapshot: makeSnapshot() });

    expect(result).toEqual({ attempted: true, posted: 1, ok: 1, failed: 0, dropped: 0, skipped: 1 });
    expect(mockPostScores).toHaveBeenCalledWith({
      [DID_A]: { score: 0, type: 'voting_engagement', timestamp: '2026-06-12T10:00:00.000Z' },
    });
  });
});

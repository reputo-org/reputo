import { HttpError } from '@reputo/deep-id-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPostScores, mockCreateDeepIdClient, mockLog, mockHeartbeat } = vi.hoisted(() => {
  const post = vi.fn();
  return {
    mockPostScores: post,
    mockCreateDeepIdClient: vi.fn(() => ({ postScores: post })),
    mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockHeartbeat: vi.fn(),
  };
});

// Keep the real chunk / errors, mock only the client factory.
vi.mock('@reputo/deep-id-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/deep-id-api')>();
  return { ...actual, createDeepIdClient: mockCreateDeepIdClient };
});

// Keep the real registry, add synthetic combined definitions for the
// normalization-metadata edge cases.
vi.mock('@reputo/reputation-algorithms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/reputation-algorithms')>();
  return {
    ...actual,
    getAlgorithmDefinition: (input: { key: string; version?: string }) => {
      if (input.key === 'custom_combo_no_norm') {
        return JSON.stringify({
          key: 'custom_combo_no_norm',
          version: '1.0.0',
          kind: 'combined',
          runtime: 'typescript',
          inputs: [],
          outputs: [],
        });
      }
      if (input.key === 'custom_combo_bad_norm') {
        return JSON.stringify({
          key: 'custom_combo_bad_norm',
          version: '1.0.0',
          kind: 'combined',
          runtime: 'typescript',
          inputs: [],
          outputs: [],
          normalization: { method: 'z_score', targetMin: 0, targetMax: 100 },
        });
      }
      return actual.getAlgorithmDefinition(input);
    },
  };
});

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({ log: mockLog, heartbeat: mockHeartbeat }),
  },
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    app: { nodeEnv: 'production' },
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

import { createSubmitCustomRawScoresActivity } from '../../../src/activities/orchestrator/deep-id-submit-custom-scores.activities.js';

const TIMESTAMP = '2026-07-22T10:00:00.000Z';

const SUB_A = 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa';
const SUB_B = 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb';
const PLC_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const PLC_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

const didFor = (i: number) => `did:sub:${String(i).padStart(24, '0')}`;

const VOTING_KEY = 'snapshots/snap-1/voting_engagement.csv';
const TOKEN_KEY = 'snapshots/snap-1/token_value_over_time.csv';

function child(key: string, weight: number) {
  return { algorithm_key: key, algorithm_version: '1.0.0', weight, inputs: [] };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: 'snap-1',
    algorithmPresetFrozen: {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        { key: 'sub_algorithms', value: [child('voting_engagement', 1)] },
      ],
    },
    outputs: { voting_engagement: VOTING_KEY },
    timestamp: TIMESTAMP,
    ...overrides,
  } as never;
}

function withChildren(subAlgorithms: unknown, outputs: Record<string, unknown>) {
  return makeInput({
    algorithmPresetFrozen: {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        { key: 'sub_algorithms', value: subAlgorithms },
      ],
    },
    outputs,
  });
}

function makeActivity(csvByKey: Record<string, string>) {
  const getObject = vi.fn().mockImplementation(async ({ key }: { key: string }) => {
    const csv = csvByKey[key];
    if (csv === undefined) {
      throw new Error(`Unexpected key: ${key}`);
    }
    return Buffer.from(csv, 'utf8');
  });
  const activity = createSubmitCustomRawScoresActivity({
    storage: { getObject } as never,
    storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
  });
  return { activity, getObject };
}

function okForAll(requestId?: string) {
  mockPostScores.mockImplementation(async (batch: Record<string, unknown>) => {
    const dids = Object.keys(batch);
    return {
      status: { ok: dids.length, failed: 0 },
      results: Object.fromEntries(dids.map((did) => [did, { message: 'OK' }])),
      ...(requestId === undefined ? {} : { requestId }),
    };
  });
}

describe('createSubmitCustomRawScoresActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts each child's native rows verbatim by DID under its own score type with the run timestamp", async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},42.5`, `${SUB_B},0`].join('\n'),
      [TOKEN_KEY]: ['did,token_value', `${SUB_A},-3`, `${SUB_B},7`].join('\n'),
    });
    okForAll();

    const result = await activity(
      withChildren([child('voting_engagement', 1), child('token_value_over_time', 3)], {
        voting_engagement: VOTING_KEY,
        token_value_over_time: TOKEN_KEY,
        custom_score_details: 'snapshots/snap-1/custom_score_details.json',
      }),
    );

    expect(mockPostScores).toHaveBeenCalledTimes(2);
    expect(mockPostScores).toHaveBeenNthCalledWith(1, {
      [SUB_A]: { score: 42.5, type: 'voting_engagement', timestamp: TIMESTAMP },
      [SUB_B]: { score: 0, type: 'voting_engagement', timestamp: TIMESTAMP },
    });
    // The token child's score column is its native `token_value`, resolved from
    // the child definition — not a shared wrapper column.
    expect(mockPostScores).toHaveBeenNthCalledWith(2, {
      [SUB_A]: { score: -3, type: 'token_value_over_time', timestamp: TIMESTAMP },
      [SUB_B]: { score: 7, type: 'token_value_over_time', timestamp: TIMESTAMP },
    });

    expect(result).toEqual({
      children: [
        {
          scoreType: 'voting_engagement',
          csvKey: VOTING_KEY,
          observation: { method: 'observed_min_max', min: 0, max: 42.5 },
          posted: 2,
          ok: 2,
          dropped: 0,
          rejected: 0,
          lastRequestId: undefined,
        },
        {
          scoreType: 'token_value_over_time',
          csvKey: TOKEN_KEY,
          observation: { method: 'observed_min_max', min: -3, max: 7 },
          posted: 2,
          ok: 2,
          dropped: 0,
          rejected: 0,
          lastRequestId: undefined,
        },
      ],
    });
  });

  it('posts a community child (discord_engagement) verbatim under its own type with observed min–max', async () => {
    const discordKey = 'snapshots/snap-1/discord_engagement.csv';
    const { activity } = makeActivity({
      [discordKey]: [
        'did,discord_engagement,message_points,active_day_points',
        `${SUB_A},11,4,4`,
        `${SUB_B},0,0,0`,
      ].join('\n'),
    });
    okForAll();

    const result = await activity(withChildren([child('discord_engagement', 2)], { discord_engagement: discordKey }));

    // The score column is the native `discord_engagement`; the per-activity
    // points columns never reach DeepID.
    expect(mockPostScores).toHaveBeenCalledWith({
      [SUB_A]: { score: 11, type: 'discord_engagement', timestamp: TIMESTAMP },
      [SUB_B]: { score: 0, type: 'discord_engagement', timestamp: TIMESTAMP },
    });
    expect(result.children).toEqual([
      expect.objectContaining({
        scoreType: 'discord_engagement',
        observation: { method: 'observed_min_max', min: 0, max: 11 },
        posted: 2,
        ok: 2,
      }),
    ]);
  });

  it('posts did:plc child rows even though the shared parent DID list holds did:sub values', async () => {
    // The parent `dids` input plays no role here: a portal child's native
    // did:plc rows survive verbatim instead of being filtered or rebuilt
    // against the parent list.
    const { activity } = makeActivity({
      'snapshots/snap-1/proposal_engagement.csv': ['did,proposal_engagement', `${PLC_A},80`, `${PLC_B},0`].join('\n'),
    });
    okForAll();

    const result = await activity(
      withChildren([child('proposal_engagement', 1)], {
        proposal_engagement: 'snapshots/snap-1/proposal_engagement.csv',
      }),
    );

    expect(mockPostScores).toHaveBeenCalledWith({
      [PLC_A]: { score: 80, type: 'proposal_engagement', timestamp: TIMESTAMP },
      [PLC_B]: { score: 0, type: 'proposal_engagement', timestamp: TIMESTAMP },
    });
    expect(result.children[0]).toMatchObject({ posted: 2, ok: 2 });
  });

  it('posts native zeros unchanged and never synthesizes additional rows', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},0`, `${SUB_B},12`].join('\n'),
    });
    okForAll();

    const result = await activity(makeInput());

    expect(mockPostScores).toHaveBeenCalledTimes(1);
    const posted = mockPostScores.mock.calls[0][0] as Record<string, { score: number }>;
    expect(Object.keys(posted)).toEqual([SUB_A, SUB_B]);
    expect(posted[SUB_A]).toEqual({ score: 0, type: 'voting_engagement', timestamp: TIMESTAMP });
    expect(result.children[0]).toMatchObject({
      posted: 2,
      observation: { method: 'observed_min_max', min: 0, max: 12 },
    });
  });

  it('updates observed bounds only from OK rows and excludes dropped and rejected rows', async () => {
    const csv = ['did,voting_engagement', `${SUB_A},5`, `${SUB_B},-3`, `${PLC_A},100`, `${PLC_B},50`].join('\n');
    const { activity } = makeActivity({ [VOTING_KEY]: csv });

    mockPostScores.mockResolvedValue({
      status: { ok: 2, failed: 2 },
      results: {
        [SUB_A]: { message: 'OK' },
        [SUB_B]: { message: 'OK' },
        [PLC_A]: { message: 'User not found' },
        [PLC_B]: { message: 'Boom' },
      },
      requestId: 'req-9',
    });

    const result = await activity(makeInput());

    expect(result.children[0]).toEqual({
      scoreType: 'voting_engagement',
      csvKey: VOTING_KEY,
      observation: { method: 'observed_min_max', min: -3, max: 5 },
      posted: 4,
      ok: 2,
      dropped: 1,
      rejected: 1,
      lastRequestId: 'req-9',
    });
  });

  it('counts a DID missing from the response results as rejected', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},1`, `${SUB_B},2`].join('\n'),
    });
    mockPostScores.mockResolvedValue({
      status: { ok: 1, failed: 1 },
      results: { [SUB_A]: { message: 'OK' } },
    });

    const result = await activity(makeInput());

    expect(result.children[0]).toMatchObject({
      ok: 1,
      rejected: 1,
      observation: { method: 'observed_min_max', min: 1, max: 1 },
    });
  });

  it('returns equal bounds when every accepted value is the same, including all-zero cohorts', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},0`, `${SUB_B},0`].join('\n'),
    });
    okForAll();

    const result = await activity(makeInput());

    expect(result.children[0].observation).toEqual({ method: 'observed_min_max', min: 0, max: 0 });
  });

  it('passes negative and large finite raw values without range checks', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},-1000000000`, `${SUB_B},750000000000`].join('\n'),
    });
    okForAll();

    const result = await activity(makeInput());

    expect(result.children[0].observation).toEqual({
      method: 'observed_min_max',
      min: -1_000_000_000,
      max: 750_000_000_000,
    });
  });

  it('fails when a selected child ends with no accepted rows', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},1`, `${SUB_B},2`].join('\n'),
    });
    mockPostScores.mockResolvedValue({
      status: { ok: 0, failed: 2 },
      results: { [SUB_A]: { message: 'User not found' }, [SUB_B]: { message: 'User not found' } },
    });

    await expect(activity(makeInput())).rejects.toThrow(
      'Child algorithm "voting_engagement" has no accepted raw scores: observed_min_max needs at least one OK entry',
    );
  });

  it.each([
    ['non-numeric', 'not-a-number'],
    ['empty', ''],
  ])("fails on a %s raw score before posting any of the child's rows", async (_case, cell) => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},1`, `${SUB_B},${cell}`].join('\n'),
    });
    okForAll();

    await expect(activity(makeInput())).rejects.toThrow(
      `Child algorithm "voting_engagement" result contains a non-finite score for "${SUB_B}"`,
    );
    expect(mockPostScores).not.toHaveBeenCalled();
  });

  it('fails on a duplicate DID in a child result', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},1`, `${SUB_A},2`].join('\n'),
    });
    okForAll();

    await expect(activity(makeInput())).rejects.toThrow(
      `Child algorithm "voting_engagement" result contains duplicate did "${SUB_A}"`,
    );
    expect(mockPostScores).not.toHaveBeenCalled();
  });

  it('splits more than 500 rows into bounded sequential batches and merges bounds across them', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => `${didFor(i)},${i}`);
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', ...rows].join('\n'),
    });
    okForAll();

    const result = await activity(makeInput());

    expect(mockPostScores).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockPostScores.mock.calls[0][0] as object)).toHaveLength(500);
    expect(Object.keys(mockPostScores.mock.calls[1][0] as object)).toHaveLength(1);
    expect(mockHeartbeat).toHaveBeenCalledWith({ scoreType: 'voting_engagement', batch: 1, totalBatches: 2 });
    expect(mockHeartbeat).toHaveBeenCalledWith({ scoreType: 'voting_engagement', batch: 2, totalBatches: 2 });
    expect(result.children[0]).toMatchObject({
      posted: 501,
      ok: 501,
      observation: { method: 'observed_min_max', min: 0, max: 500 },
    });
  });

  it('reposts identical logical entries and timestamps when the activity retries', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},4`, `${SUB_B},0`].join('\n'),
    });
    okForAll();

    await activity(makeInput());
    await activity(makeInput());

    expect(mockPostScores).toHaveBeenCalledTimes(2);
    expect(mockPostScores.mock.calls[1][0]).toEqual(mockPostScores.mock.calls[0][0]);
  });

  it('propagates a transport failure on a later child after an earlier child already posted', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},1`].join('\n'),
      [TOKEN_KEY]: ['did,token_value', `${SUB_B},2`].join('\n'),
    });
    mockPostScores
      .mockResolvedValueOnce({ status: { ok: 1, failed: 0 }, results: { [SUB_A]: { message: 'OK' } } })
      .mockRejectedValueOnce(new HttpError(503, 'Service Unavailable'));

    await expect(
      activity(
        withChildren([child('voting_engagement', 1), child('token_value_over_time', 1)], {
          voting_engagement: VOTING_KEY,
          token_value_over_time: TOKEN_KEY,
        }),
      ),
    ).rejects.toThrow('HTTP 503');

    expect(mockPostScores).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('rejects a %s child weight before posting anything', async (_case, weight) => {
    const { activity, getObject } = makeActivity({});
    okForAll();

    await expect(
      activity(withChildren([child('voting_engagement', weight)], { voting_engagement: VOTING_KEY })),
    ).rejects.toThrow('Invalid sub_algorithms.0.weight');

    expect(getObject).not.toHaveBeenCalled();
    expect(mockPostScores).not.toHaveBeenCalled();
  });

  it('fails before posting when a selected child has no native CSV output', async () => {
    const { activity, getObject } = makeActivity({});

    await expect(activity(withChildren([child('voting_engagement', 1)], {}))).rejects.toThrow(
      'Child algorithm "voting_engagement" has no native CSV output to submit',
    );

    expect(getObject).not.toHaveBeenCalled();
    expect(mockPostScores).not.toHaveBeenCalled();
  });

  it('fails when a selected child is not a DeepID score type', async () => {
    const { activity } = makeActivity({});

    await expect(
      activity(withChildren([child('deepfunding_sync', 1)], { deepfunding_sync: 'snapshots/snap-1/x.csv' })),
    ).rejects.toThrow('Child algorithm "deepfunding_sync" is not a DeepID score type');
  });

  it('rejects a non-combined snapshot', async () => {
    const { activity } = makeActivity({});

    await expect(
      activity(
        makeInput({
          algorithmPresetFrozen: { key: 'voting_engagement', version: '1.0.0', inputs: [] },
        }),
      ),
    ).rejects.toThrow('submitCustomRawScores supports only combined snapshots, got "voting_engagement"');
  });

  it('defaults to observed min–max when the definition has no normalization metadata', async () => {
    const { activity } = makeActivity({
      [VOTING_KEY]: ['did,voting_engagement', `${SUB_A},3`].join('\n'),
    });
    okForAll();

    const result = await activity(
      makeInput({
        algorithmPresetFrozen: {
          key: 'custom_combo_no_norm',
          version: '1.0.0',
          inputs: [{ key: 'sub_algorithms', value: [child('voting_engagement', 1)] }],
        },
      }),
    );

    expect(result.children[0].observation).toEqual({ method: 'observed_min_max', min: 3, max: 3 });
  });

  it('fails on an unsupported normalization method before posting', async () => {
    const { activity, getObject } = makeActivity({});

    await expect(
      activity(
        makeInput({
          algorithmPresetFrozen: {
            key: 'custom_combo_bad_norm',
            version: '1.0.0',
            inputs: [{ key: 'sub_algorithms', value: [child('voting_engagement', 1)] }],
          },
        }),
      ),
    ).rejects.toThrow('Unsupported normalization method: z_score');

    expect(getObject).not.toHaveBeenCalled();
    expect(mockPostScores).not.toHaveBeenCalled();
  });
});

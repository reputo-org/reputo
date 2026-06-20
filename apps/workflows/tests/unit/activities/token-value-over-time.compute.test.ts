import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResourceId } from '../../../src/activities/typescript/algorithms/token-value-over-time/types.js';

const FET_ETHEREUM: ResourceId = 'ethereum:0xaea46a60368a7bd060eec7df8cba43b7ef41ad85';

const {
  mockGenerateKey,
  mockStringifyCsvAsync,
  mockLoadEvmTransferPage,
  mockLoadCardanoTransferPage,
  mockExtractInputs,
  mockLoadResourceCatalog,
  mockResolveSelectedResources,
  mockGetStakingContractAddresses,
  mockLoadWalletAddressMap,
  mockGetDids,
  mockBuildWalletDidsIndex,
  mockGetWalletsForSelectedResources,
  mockGetWalletsForChain,
  mockInitializeWalletLots,
  mockCreateOnchainRepos,
  mockReplayTransfers,
  mockScoreWalletLots,
  mockFormatBenchmarkOutput,
  mockHeartbeat,
  mockReposClose,
} = vi.hoisted(() => ({
  mockGenerateKey: vi.fn(),
  mockStringifyCsvAsync: vi.fn(),
  mockLoadEvmTransferPage: vi.fn(),
  mockLoadCardanoTransferPage: vi.fn(),
  mockExtractInputs: vi.fn(),
  mockLoadResourceCatalog: vi.fn(),
  mockResolveSelectedResources: vi.fn(),
  mockGetStakingContractAddresses: vi.fn(),
  mockLoadWalletAddressMap: vi.fn(),
  mockGetDids: vi.fn(),
  mockBuildWalletDidsIndex: vi.fn(),
  mockGetWalletsForSelectedResources: vi.fn(),
  mockGetWalletsForChain: vi.fn(),
  mockInitializeWalletLots: vi.fn(),
  mockCreateOnchainRepos: vi.fn(),
  mockReplayTransfers: vi.fn(),
  mockScoreWalletLots: vi.fn(),
  mockFormatBenchmarkOutput: vi.fn(),
  mockHeartbeat: vi.fn(),
  mockReposClose: vi.fn(),
}));

vi.mock('@reputo/storage', () => ({
  generateKey: mockGenerateKey,
}));

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: {
        info: vi.fn(),
        warn: vi.fn(),
      },
      heartbeat: mockHeartbeat,
    }),
  },
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    storage: {
      bucket: 'test-bucket',
    },
  },
}));

vi.mock('../../../src/shared/utils/index.js', () => ({
  stringifyCsvAsync: mockStringifyCsvAsync,
}));

vi.mock('../../../src/activities/typescript/algorithms/token-value-over-time/utils/index.js', () => ({
  createOnchainRepos: mockCreateOnchainRepos,
  extractInputs: mockExtractInputs,
  loadResourceCatalog: mockLoadResourceCatalog,
  resolveSelectedResources: mockResolveSelectedResources,
  getStakingContractAddresses: mockGetStakingContractAddresses,
  loadWalletAddressMap: mockLoadWalletAddressMap,
  getDids: mockGetDids,
  buildWalletDidsIndex: mockBuildWalletDidsIndex,
  getWalletsForSelectedResources: mockGetWalletsForSelectedResources,
  getWalletsForChain: mockGetWalletsForChain,
  initializeWalletLots: mockInitializeWalletLots,
  loadEvmTransferPage: mockLoadEvmTransferPage,
  loadCardanoTransferPage: mockLoadCardanoTransferPage,
}));

vi.mock('../../../src/activities/typescript/algorithms/token-value-over-time/pipeline/index.js', () => ({
  replayTransfers: mockReplayTransfers,
  scoreWalletLots: mockScoreWalletLots,
}));

vi.mock('../../../src/activities/typescript/algorithms/token-value-over-time/benchmark/index.js', () => ({
  formatBenchmarkOutput: mockFormatBenchmarkOutput,
}));

import { computeTokenValueOverTime } from '../../../src/activities/typescript/algorithms/token-value-over-time/compute.js';

describe('computeTokenValueOverTime pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const walletLots = new Map([['0xwallet1', []]]);
    mockExtractInputs.mockReturnValue({
      maturationThresholdDays: 90,
      selectedResources: [{ chain: 'ethereum', resourceKey: 'fet_token' }],
      didsKey: 'uploads/dids.json',
      effectiveDateRange: {
        fromTimestampUnix: undefined,
        toTimestampUnix: Math.floor(new Date('2026-04-01T00:00:00.000Z').getTime() / 1000),
      },
    });
    mockLoadResourceCatalog.mockReturnValue([
      {
        chain: 'ethereum',
        key: 'fet_token',
        kind: 'token',
        identifier: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85',
        tokenIdentifier: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85',
        tokenKey: 'fet',
      },
    ]);
    mockResolveSelectedResources.mockReturnValue([
      {
        chain: 'ethereum',
        resourceKey: 'fet_token',
        kind: 'token',
        identifier: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85',
        tokenIdentifier: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85',
        resourceId: FET_ETHEREUM,
      },
    ]);
    mockGetStakingContractAddresses.mockReturnValue(new Set());
    mockLoadWalletAddressMap.mockResolvedValue({
      dids: {
        'SubID-1': {
          ethereum: ['0xwallet1'],
        },
        'SubID-2': {
          ethereum: ['0xwallet1'],
        },
        'SubID-3': {},
      },
    });
    mockGetDids.mockReturnValue(['SubID-1', 'SubID-2', 'SubID-3']);
    mockBuildWalletDidsIndex.mockReturnValue(new Map([['0xwallet1', ['SubID-1', 'SubID-2']]]));
    mockGetWalletsForSelectedResources.mockReturnValue(['0xwallet1']);
    mockGetWalletsForChain.mockReturnValue(['0xwallet1']);
    mockInitializeWalletLots.mockReturnValue(walletLots);
    mockCreateOnchainRepos.mockResolvedValue({
      close: mockReposClose,
    });
    mockLoadEvmTransferPage
      .mockResolvedValueOnce({
        items: [
          {
            resourceId: FET_ETHEREUM,
            blockOrdinal: '0x1',
            transactionHash: '0xaaa',
            logIndex: 0,
            fromAddress: '0xother',
            toAddress: '0xwallet1',
            amount: 10,
            blockTimestamp: '2026-01-01T00:00:00.000Z',
            isStaking: false,
          },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [
          {
            resourceId: FET_ETHEREUM,
            blockOrdinal: '0x2',
            transactionHash: '0xbbb',
            logIndex: 0,
            fromAddress: '0xwallet1',
            toAddress: '0xother',
            amount: 4,
            blockTimestamp: '2026-01-02T00:00:00.000Z',
            isStaking: false,
          },
        ],
        hasMore: false,
      });
    mockReplayTransfers
      .mockReturnValueOnce({
        processed: 1,
        skippedZeroAmount: 0,
        skippedSelfTransfers: 0,
        skippedStaking: 0,
      })
      .mockReturnValueOnce({
        processed: 1,
        skippedZeroAmount: 0,
        skippedSelfTransfers: 0,
        skippedStaking: 0,
      });
    mockScoreWalletLots.mockReturnValue([{ wallet_address: '0xwallet1', token_value: 1.5, lots: [] }]);
    mockStringifyCsvAsync.mockResolvedValue('did,token_value\nSubID-1,1.5\nSubID-2,1.5\nSubID-3,0');
    mockGenerateKey
      .mockReturnValueOnce('outputs/token-value-over-time.csv')
      .mockReturnValueOnce('outputs/token-value-over-time-details.json');
    mockFormatBenchmarkOutput.mockReturnValue({ ok: true });
    mockReposClose.mockResolvedValue(undefined);
  });

  it('replays all pages before scoring and uploads final outputs', async () => {
    const storage = { putObject: vi.fn().mockResolvedValue(undefined) };

    const result = await computeTokenValueOverTime(
      {
        id: 'snapshot-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        algorithmPresetFrozen: {
          key: 'token_value_over_time',
          inputs: [],
        },
      } as never,
      storage as never,
    );

    expect(mockLoadWalletAddressMap).toHaveBeenCalledWith({
      storage,
      bucket: 'test-bucket',
      key: 'uploads/dids.json',
    });
    expect(mockGetDids).toHaveBeenCalledWith({
      dids: {
        'SubID-1': {
          ethereum: ['0xwallet1'],
        },
        'SubID-2': {
          ethereum: ['0xwallet1'],
        },
        'SubID-3': {},
      },
    });
    expect(mockBuildWalletDidsIndex).toHaveBeenCalledWith({
      dids: {
        'SubID-1': {
          ethereum: ['0xwallet1'],
        },
        'SubID-2': {
          ethereum: ['0xwallet1'],
        },
        'SubID-3': {},
      },
    });
    expect(mockGetWalletsForChain).toHaveBeenCalledWith(
      {
        dids: {
          'SubID-1': {
            ethereum: ['0xwallet1'],
          },
          'SubID-2': {
            ethereum: ['0xwallet1'],
          },
          'SubID-3': {},
        },
      },
      'ethereum',
    );
    expect(mockLoadEvmTransferPage).toHaveBeenCalledTimes(2);
    expect(mockReplayTransfers).toHaveBeenCalledTimes(2);

    const lastReplayCallOrder = mockReplayTransfers.mock.invocationCallOrder.at(-1) ?? 0;
    const scoreCallOrder = mockScoreWalletLots.mock.invocationCallOrder[0] ?? 0;
    expect(scoreCallOrder).toBeGreaterThan(lastReplayCallOrder);

    expect(mockFormatBenchmarkOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        didCount: 3,
        transferCount: 2,
        replay: {
          processed: 2,
          skippedZeroAmount: 0,
          skippedSelfTransfers: 0,
          skippedStaking: 0,
        },
        dids: [
          {
            did: 'SubID-1',
            token_value: 1.5,
            wallets: [{ wallet_address: '0xwallet1', token_value: 1.5, lots: [] }],
          },
          {
            did: 'SubID-2',
            token_value: 1.5,
            wallets: [{ wallet_address: '0xwallet1', token_value: 1.5, lots: [] }],
          },
          {
            did: 'SubID-3',
            token_value: 0,
            wallets: [],
          },
        ],
      }),
    );
    expect(mockHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'load-transfers',
        transferCount: 2,
      }),
    );
    expect(mockHeartbeat).toHaveBeenCalledWith({ phase: 'upload' });

    expect(storage.putObject).toHaveBeenNthCalledWith(1, {
      bucket: 'test-bucket',
      key: 'outputs/token-value-over-time.csv',
      body: 'did,token_value\nSubID-1,1.5\nSubID-2,1.5\nSubID-3,0',
      contentType: 'text/csv',
    });
    expect(storage.putObject).toHaveBeenNthCalledWith(2, {
      bucket: 'test-bucket',
      key: 'outputs/token-value-over-time-details.json',
      body: JSON.stringify({ ok: true }, null, 2),
      contentType: 'application/json',
    });
    expect(result).toEqual({
      outputs: {
        token_value_over_time: 'outputs/token-value-over-time.csv',
        token_value_over_time_details: 'outputs/token-value-over-time-details.json',
      },
    });
    expect(mockReposClose).toHaveBeenCalledOnce();
  });
});

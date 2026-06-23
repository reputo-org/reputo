export type SupportedChain = 'ethereum' | 'cardano';

export interface ResourceCatalogEntry {
  chain: SupportedChain;
  key: string;
  kind: 'token' | 'contract';
  identifier: string;
  tokenIdentifier: string;
  tokenKey: string;
  parentResourceKey?: string;
}

/** Unique resource identifier: `${chain}:${identifier}` */
export type ResourceId = string;

export function buildResourceId(chain: string, identifier: string): ResourceId {
  return `${chain}:${identifier.toLowerCase()}`;
}

export interface SelectedResourceInput {
  chain: SupportedChain;
  resourceKey: string;
}

export interface ResolvedResource {
  chain: SupportedChain;
  resourceKey: string;
  kind: 'token' | 'contract';
  identifier: string;
  tokenIdentifier: string;
  resourceId: ResourceId;
}

export interface EffectiveDateRange {
  fromTimestampUnix: number | undefined;
  toTimestampUnix: number;
}

export interface TokenValueOverTimeParams {
  maturationThresholdDays: number;
  selectedResources: SelectedResourceInput[];
  didsKey: string;
  effectiveDateRange: EffectiveDateRange;
}

export interface OrderedTransferEvent {
  resourceId: ResourceId;
  blockOrdinal: string;
  transactionHash: string;
  logIndex: number;
  fromAddress: string | null;
  toAddress: string | null;
  amount: number;
  blockTimestamp: string | null;
  isStaking: boolean;
}

export type WalletLot = {
  resourceId: ResourceId;
  amountRemaining: number;
  receivedAt: string | null;
  sourceTransferId: string;
};

export type WalletLotsState = Map<string, WalletLot[]>;

export interface ReplayStats {
  processed: number;
  skippedZeroAmount: number;
  skippedSelfTransfers: number;
  skippedStaking: number;
}

export interface LotScoreDetail {
  resource_id: ResourceId;
  source_transfer_id: string;
  amount_remaining: number;
  age_days: number;
  weight: number;
  lot_value: number;
}

export interface WalletScoreDetail {
  wallet_address: string;
  token_value: number;
  lots: LotScoreDetail[];
}

export interface DidScoreDetail {
  did: string;
  token_value: number;
  wallets: WalletScoreDetail[];
}

export interface TokenValueOverTimeBenchmark {
  dids: DidScoreDetail[];
  metadata: {
    snapshot_id: string;
    computed_at: string;
    maturation_threshold_days: number;
    selected_resources: SelectedResourceInput[];
    selected_resource_ids: ResourceId[];
    did_count: number;
    target_wallet_count: number;
    transfer_count: number;
    replay: ReplayStats;
  };
}

export const SCORE_PRECISION = 6;

export function roundScore(score: number): number {
  return Math.round(score * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

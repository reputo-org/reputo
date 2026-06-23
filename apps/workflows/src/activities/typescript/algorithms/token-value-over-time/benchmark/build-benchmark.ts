import type {
  DidScoreDetail,
  ReplayStats,
  ResourceId,
  SelectedResourceInput,
  TokenValueOverTimeBenchmark,
} from '../types.js';

export function formatBenchmarkOutput(input: {
  snapshotId: string;
  maturationThresholdDays: number;
  selectedResources: SelectedResourceInput[];
  selectedResourceIds: ResourceId[];
  didCount: number;
  targetWalletCount: number;
  transferCount: number;
  replay: ReplayStats;
  dids: DidScoreDetail[];
}): TokenValueOverTimeBenchmark {
  return {
    dids: input.dids,
    metadata: {
      snapshot_id: input.snapshotId,
      computed_at: new Date().toISOString(),
      maturation_threshold_days: input.maturationThresholdDays,
      selected_resources: input.selectedResources,
      selected_resource_ids: input.selectedResourceIds,
      did_count: input.didCount,
      target_wallet_count: input.targetWalletCount,
      transfer_count: input.transferCount,
      replay: input.replay,
    },
  };
}

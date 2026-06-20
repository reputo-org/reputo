import type {
  AlgorithmPresetFrozenDto,
  ApiSnapshotActivities,
  GetSnapshotInput,
  SnapshotDto,
  UpdateSnapshotInput,
} from '@reputo/contracts';
import type { Storage } from '@reputo/storage';

import type { AlgorithmResult, StorageConfig } from './algorithm.types.js';
import type { ResolveDependencyInput, ResolveDependencyResult } from './dependency.types.js';

/** Wire-level snapshot shape returned by the API's snapshot activities. */
export type Snapshot = SnapshotDto;

/** Wire-level frozen algorithm preset shape carried inside a snapshot. */
export type AlgorithmPresetFrozen = AlgorithmPresetFrozenDto;

export type { ApiSnapshotActivities, GetSnapshotInput, UpdateSnapshotInput };

export interface GetAlgorithmDefinitionInput {
  key: string;
  version?: string;
}

export interface GetAlgorithmDefinitionOutput {
  algorithmDefinition: {
    key: string;
    name: string;
    category: string;
    summary: string;
    description: string;
    version: string;
    inputs: unknown[];
    outputs: unknown[];
    runtime: string;
    dependencies?: { key: string }[];
  };
}

export interface AlgorithmLibraryActivities {
  getAlgorithmDefinition: (input: GetAlgorithmDefinitionInput) => Promise<GetAlgorithmDefinitionOutput>;
}

export interface OnchainDataSyncContext {
  databaseUrl: string;
  alchemyApiKey: string;
  blockfrostAPIKey: string;
}

/** Context for dependency resolution activities on the orchestrator worker (non-onchain). */
export interface OrchestratorDependencyResolverContext {
  storage: Storage;
  storageConfig: StorageConfig;
}

export interface DependencyResolverActivities {
  resolveDependency: (input: ResolveDependencyInput) => Promise<ResolveDependencyResult>;
}

export interface DeepfundingSyncContext {
  storage: Storage;
  storageConfig: StorageConfig;
}

export interface DeepFundingSyncInput {
  snapshotId: string;
}

export interface DeepFundingSyncOutput {
  deepfunding_db_key: string;
  deepfunding_manifest_key: string;
}

/** Context for the DeepID activities on the orchestrator worker. */
export interface DeepIdSyncContext {
  storage: Storage;
  storageConfig: StorageConfig;
}

export interface DeepIdSyncInput {
  snapshotId: string;
}

export interface DeepIdSyncOutput {
  /** S3 key of the assembled SubID JSON (`did:sub` → wallets) for the wallet algorithms. */
  didsKey: string;
}

/** Activities that post computed snapshot scores back to DeepID after a run completes. */
export interface DeepIdPostScoresActivities {
  postSnapshotScores: (input: PostSnapshotScoresInput) => Promise<PostSnapshotScoresResult>;
}

export interface PostSnapshotScoresInput {
  snapshot: Snapshot;
}

export interface PostSnapshotScoresResult {
  posted: number;
  ok: number;
  failed: number;
  skipped: number;
}

export type AlgorithmComputeFunction = (snapshot: Snapshot, storage: Storage) => Promise<AlgorithmResult>;

export type TypescriptAlgorithmDispatcherActivities = {
  runTypescriptAlgorithm: (snapshot: Snapshot) => Promise<AlgorithmResult>;
};

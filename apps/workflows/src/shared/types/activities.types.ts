import type {
  AlgorithmPresetFrozenDto,
  ApiSnapshotActivities,
  GetSnapshotInput,
  SnapshotDto,
  UpdateSnapshotInput,
} from '@reputo/contracts';
import type { ScoreType } from '@reputo/deep-id-api';
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

/** Context for the community dataset dependency activities on the community worker. */
export interface CommunityDependencyResolverContext {
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
  /** S3 key of the assembled DID JSON (`did:sub` → wallets) for the wallet algorithms. */
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
  /** Expected "User not found" rejections — users who have not consented to Reputo. */
  dropped: number;
  skipped: number;
}

/** Observed min–max observation for one child: bounds of its accepted (`OK`) raw scores. */
export interface ObservedMinMaxObservation {
  method: 'observed_min_max';
  min: number;
  max: number;
}

/**
 * Per-child normalization inputs collected by the active normalization method
 * during raw-score submission. Currently observed min–max is the only method.
 */
export type NormalizationObservation = ObservedMinMaxObservation;

/**
 * Activities that submit a combined snapshot's native raw child scores to
 * DeepID before the snapshot completes. Unlike `postSnapshotScores`, a failure
 * here fails the run.
 */
export interface DeepIdSubmitCustomScoresActivities {
  submitCustomRawScores: (input: SubmitCustomRawScoresInput) => Promise<SubmitCustomRawScoresResult>;
}

export interface SubmitCustomRawScoresInput {
  snapshotId: string;
  /** The snapshot's frozen combined preset — the selected children and their weights. */
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  /** The compute result's outputs, passed straight from the workflow (never refetched from the stored snapshot). */
  outputs: AlgorithmResult['outputs'];
  /** Run-consistent ISO timestamp generated once by the workflow and reused verbatim on every retry. */
  timestamp: string;
}

/** Aggregate submission outcome for one child; never carries score rows. */
export interface CustomRawScoresChildResult {
  scoreType: ScoreType;
  /** S3 key of the child's native CSV artifact — its output identifier for later stages. */
  csvKey: string;
  observation: NormalizationObservation;
  posted: number;
  ok: number;
  /** Expected "User not found" rejections — users who have not consented to Reputo. */
  dropped: number;
  /** Unexpected per-DID rejections; excluded from the observation. */
  rejected: number;
  lastRequestId?: string;
}

export interface SubmitCustomRawScoresResult {
  children: CustomRawScoresChildResult[];
}

/** One child's observed normalization inputs, carried from raw submission to encrypted evaluation. */
export interface EncryptedChildObservation {
  scoreType: ScoreType;
  observation: NormalizationObservation;
}

/**
 * Activities that evaluate a combined snapshot's encrypted child scores and
 * submit the final `custom_score_encr` entries. Like `submitCustomRawScores`,
 * a fatal failure here fails the run.
 */
export interface DeepIdSubmitEncryptedScoresActivities {
  submitCustomEncryptedScores: (input: SubmitCustomEncryptedScoresInput) => Promise<SubmitCustomEncryptedScoresResult>;
}

export interface SubmitCustomEncryptedScoresInput {
  snapshotId: string;
  /** The snapshot's frozen combined preset — the selected children and their weights. */
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  /** Per-child observations collected from the raw submission's accepted (`OK`) rows. */
  observations: EncryptedChildObservation[];
  /** Run-consistent ISO timestamp generated once by the workflow and reused verbatim on every retry. */
  timestamp: string;
}

/** Aggregate diagnostics of one encrypted processing pass; never carries DIDs or ciphertexts. */
export interface EncryptedSubmissionPassDiagnostics {
  /** Unified users whose every selected child field was `encrypted`. */
  complete: number;
  /** Unified users excluded for a `null` or absent selected field; never zero-filled. */
  incomplete: number;
  scannedUsers: number;
  pages: number;
  /** Full-pass restarts caused by cursor expiry within this activity invocation. */
  cursorRestarts: number;
  lastRequestId?: string;
}

/** Every complete user was evaluated and every final entry returned `OK`. */
export interface EncryptedScoresSubmittedResult extends EncryptedSubmissionPassDiagnostics {
  outcome: 'submitted';
  /** Final `custom_score_encr` entries DeepID accepted (equals `complete`). */
  submitted: number;
  /** Bounded `POST /v1/clients/scores` batches sent. */
  batches: number;
  /** Distinct SEAL metadata keys registered during the pass. */
  registeredKeys: number;
}

/**
 * A potentially complete user still had a selected field in
 * `pending_encryption`, so the pass stopped before evaluating its page. The
 * workflow returns to readiness polling; entries already accepted this pass
 * are safely resubmitted later under the same logical identity and timestamp.
 */
export interface EncryptedScoresPendingResult extends EncryptedSubmissionPassDiagnostics {
  outcome: 'pending_encryption';
}

export type SubmitCustomEncryptedScoresResult = EncryptedScoresSubmittedResult | EncryptedScoresPendingResult;

/** Activities that check whether a combined snapshot's child scores are ready for encrypted evaluation. */
export interface DeepIdEncryptionReadinessActivities {
  checkEncryptionReadiness: (input: CheckEncryptionReadinessInput) => Promise<CheckEncryptionReadinessResult>;
}

export interface CheckEncryptionReadinessInput {
  snapshotId: string;
  /** The snapshot's frozen combined preset — the selected children define the encrypted scopes. */
  algorithmPresetFrozen: AlgorithmPresetFrozen;
}

/** Aggregate classification of one full readiness pass; never carries DIDs or ciphertexts. */
export interface EncryptionReadinessCounts {
  /** Unified users whose every selected child field is `encrypted`. */
  complete: number;
  /** Every selected field present but at least one still `pending_encryption` — the run keeps waiting. */
  potentiallyComplete: number;
  /** At least one selected field `null` or absent — excluded from the cohort, never zero-filled. */
  incomplete: number;
}

export interface CheckEncryptionReadinessResult {
  /** True only when a full pass contains no potentially complete user. */
  ready: boolean;
  counts: EncryptionReadinessCounts;
  scannedUsers: number;
  pages: number;
  /** Full-pass restarts caused by cursor expiry within this poll. */
  cursorRestarts: number;
  lastRequestId?: string;
}

export type AlgorithmComputeFunction = (snapshot: Snapshot, storage: Storage) => Promise<AlgorithmResult>;

export type TypescriptAlgorithmDispatcherActivities = {
  runTypescriptAlgorithm: (snapshot: Snapshot) => Promise<AlgorithmResult>;
};

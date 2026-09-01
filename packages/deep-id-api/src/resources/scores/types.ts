/**
 * Plaintext DeepID score types accepted by `POST /v1/clients/scores`. These are
 * also the Reputo algorithm keys (the keys map 1:1 to score types, so no
 * translation is needed when posting).
 */
export const SCORE_TYPES = [
  'voting_engagement',
  'contribution_score',
  'proposal_engagement',
  'token_value_over_time',
  'custom_score',
  'github_engagement',
  'discord_engagement',
  'mattermost_engagement',
] as const;

export type ScoreType = (typeof SCORE_TYPES)[number];

/** A plaintext (raw child) score entry. */
export interface PlainScoreEntry {
  /** Any finite number; `0` and negative values are valid scores and are posted as-is. */
  score: number;
  type: ScoreType;
  /**
   * Caller-supplied ISO 8601 timestamp, kept identical across every entry and
   * retry of one run. DeepID dedups on it (an older timestamp never overwrites
   * a newer stored score) and guarantees idempotent retries of the same logical
   * entry and timestamp. The client never generates or replaces it; retrying a
   * changed payload for the same DID, type, and timestamp is invalid caller
   * behavior.
   */
  timestamp: string;
}

/** The final encrypted `custom_score` entry for one unified user. */
export interface EncryptedScoreEntry {
  /** Serialized CKKS ciphertext produced by homomorphic evaluation (non-empty). */
  ciphertext: string;
  /** `id` of the SEAL metadata whose key the child ciphertexts belong to, echoed verbatim. */
  keyId: string;
  type: 'custom_score_encr';
  /** Same contract as {@link PlainScoreEntry.timestamp}. */
  timestamp: string;
}

/**
 * One `POST /v1/clients/scores` entry — a discriminated union on `type`. An
 * entry never carries both `score` and `ciphertext`; `postScores` rejects such
 * payloads before sending anything.
 */
export type ScoreEntry = PlainScoreEntry | EncryptedScoreEntry;

/** `POST /v1/clients/scores` body: a map of `did:(plc|sub):…` → score entry. */
export type PostScoresRequest = Record<string, ScoreEntry>;

/** Per-user result. `message` is `"OK"` on success; see the spec for failure messages. */
export interface PostScoreResult {
  message: string;
}

/** `POST /v1/clients/scores` response. Returns `200` even when some users fail. */
export interface PostScoresResponse {
  status: { ok: number; failed: number };
  results: Record<string, PostScoreResult>;
  /**
   * The `x-request-id` response header when DeepID sends one — quote it in
   * diagnostics instead of request or response bodies. Not part of the body.
   */
  requestId?: string;
}

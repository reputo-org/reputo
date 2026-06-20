/**
 * DeepID score types accepted by `POST /v1/clients/scores`. These are also the
 * Reputo algorithm keys (the keys map 1:1 to score types, so no translation is
 * needed when posting).
 */
export type ScoreType =
  | 'voting_engagement'
  | 'contribution_score'
  | 'proposal_engagement'
  | 'token_value_over_time'
  | 'custom_score';

export interface ScoreEntry {
  /** Number in any range; the DeepID UI displays 0–100. */
  score: number;
  type: ScoreType;
  /** ISO 8601 string. Controls dedup: an older timestamp never overwrites a newer stored score. */
  timestamp: string;
}

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
}

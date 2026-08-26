/** A linked wallet, returned in `wallets[]` when the `wallets` scope is granted. */
export interface DeepIdWallet {
  /** Chain type, e.g. `ethereum` or `cardano`. */
  type: string;
  address: string;
}

/** A stored score, returned under `scores.<type>` when a score scope is granted. */
export interface DeepIdScore {
  /** Numeric string, e.g. `"82"`. */
  value: string;
  updatedAt: string;
  provider: { name: string | null; uri: string | null } | null;
}

/**
 * Encrypted read scopes for `GET /v1/users` — one per child score type. They
 * are also the child field names under `scores_encr`.
 */
export const ENCRYPTED_SCORE_SCOPES = [
  'voting_engagement_encr',
  'contribution_score_encr',
  'proposal_engagement_encr',
  'token_value_over_time_encr',
] as const;

/** One encrypted child scope / `scores_encr` field name, e.g. `voting_engagement_encr`. */
export type EncryptedScoreScope = (typeof ENCRYPTED_SCORE_SCOPES)[number];

/** Encryption state of one `scores_encr` child field. Any other status is rejected at parse time. */
export type EncryptedScoreStatus = 'encrypted' | 'pending_encryption';

/** A ready encrypted child score: the ciphertext is present and non-empty. */
export interface EncryptedScoreReady {
  status: 'encrypted';
  /** Serialized CKKS ciphertext. */
  ciphertext: string;
}

/** DeepID accepted the raw score but has not finished encrypting it yet. */
export interface EncryptedScorePending {
  status: 'pending_encryption';
  ciphertext: string | null;
}

/** One `scores_encr` child field, when it is present and non-null. */
export type EncryptedScoreField = EncryptedScoreReady | EncryptedScorePending;

/**
 * `scores_encr` on a user, present when encrypted scopes are requested and
 * consented. A requested child field is absent or `null` when DeepID holds no
 * encrypted score for that type. Validate with `parseEncryptedScores` before
 * trusting the shape.
 */
export type DeepIdEncryptedScores = {
  /** Relative URL of the public SEAL metadata for this user's ciphertexts, or `null`. */
  'seal-metadata': string | null;
} & {
  [K in EncryptedScoreScope]?: EncryptedScoreField | null;
};

/**
 * One user entry from `GET /v1/users` (or `GET /v1/user`). `scopes` is the
 * intersection of token scopes and what the user consented to; a field is only
 * present when its scope is in `scopes`.
 */
export interface DeepIdUser {
  scopes: string[];
  wallets?: DeepIdWallet[];
  scores?: Record<string, DeepIdScore | null>;
  /** Present when encrypted score scopes are granted; see {@link DeepIdEncryptedScores}. */
  scores_encr?: DeepIdEncryptedScores;
  [key: string]: unknown;
}

/** `GET /v1/users` response body: a map of `did:sub:…` → user data. */
export type UsersResponse = Record<string, DeepIdUser>;

export interface GetUsersOptions {
  /** 1–100; defaults to the client's `defaultPageSize`. DeepID rejects anything above 100. */
  pageSize?: number;
  /** Space-separated subset of token scopes to include; must be a subset of the token's scopes. */
  filteredTokenScopes?: string;
}

/** One page of `GET /v1/users` results plus the `x-next` cursor (absent on the last page). */
export interface UsersPage {
  users: UsersResponse;
  next?: string;
  /**
   * The `x-request-id` response header when DeepID sends one — quote it in
   * diagnostics instead of request or response bodies. Not part of the body.
   */
  requestId?: string;
}

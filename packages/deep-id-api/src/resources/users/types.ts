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
  'github_engagement_encr',
  'discord_engagement_encr',
  'mattermost_engagement_encr',
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
 * Community identity scopes for `GET /v1/users` — one per platform. They are
 * also the top-level field names holding the linked account, so requesting
 * `discord` adds a `discord` field to every user in the response.
 */
export const SOCIAL_IDENTITY_SCOPES = ['github', 'discord', 'mattermost'] as const;

/** One community identity scope / user field name, e.g. `discord`. */
export type SocialIdentityScope = (typeof SOCIAL_IDENTITY_SCOPES)[number];

/**
 * A platform account a user linked in DeepID, returned under its scope name.
 * `username` is the only join key DeepID exposes today, so a rename on the
 * platform breaks the link until the user re-verifies. Validate with
 * `parseSocialIdentity` before trusting the shape.
 */
export interface DeepIdSocialIdentity {
  username: string;
  /** ISO 8601 instant DeepID verified the link. */
  verifiedAt: string;
  /** ISO 8601 instant the verification lapses; DeepID re-verifies before then. */
  expiresAt: string;
  /** Signed verifiable credential for the link, or `null`. Never log it. */
  vc: string | null;
}

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
  /** Present when the `github` scope is granted; `null` when no account is linked. */
  github?: DeepIdSocialIdentity | null;
  /** Present when the `discord` scope is granted; `null` when no account is linked. */
  discord?: DeepIdSocialIdentity | null;
  /** Present when the `mattermost` scope is granted; `null` when no account is linked. */
  mattermost?: DeepIdSocialIdentity | null;
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

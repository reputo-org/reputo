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
 * One user entry from `GET /v1/users` (or `GET /v1/user`). `scopes` is the
 * intersection of token scopes and what the user consented to; a field is only
 * present when its scope is in `scopes`.
 */
export interface DeepIdUser {
  scopes: string[];
  wallets?: DeepIdWallet[];
  scores?: Record<string, DeepIdScore | null>;
  [key: string]: unknown;
}

/** `GET /v1/users` response body: a map of `did:sub:…` → user data. */
export type UsersResponse = Record<string, DeepIdUser>;

export interface GetUsersOptions {
  /** 1–1000; defaults to the client's `defaultPageSize`. */
  pageSize?: number;
  /** Space-separated subset of token scopes to include; must be a subset of the token's scopes. */
  filteredTokenScopes?: string;
}

/** One page of `GET /v1/users` results plus the `x-next` cursor (absent on the last page). */
export interface UsersPage {
  users: UsersResponse;
  next?: string;
}

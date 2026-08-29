import type { CommunityAdapter } from '@reputo/community-api';
import { type DeepIdUser, parseSocialIdentity, type UsersPage } from '@reputo/deep-id-api';
import type { CommunityEngineLogger } from './dataset-engine.js';

/**
 * One consented user's frozen cohort membership. `accountId` is the matched
 * stable platform account id; an unmatched user keeps an explicit row so the
 * scoring step emits their zero with a flag — never a guess.
 */
export interface CommunityCohortRow {
  did: string;
  username: string | null;
  accountId: string | null;
  status: 'matched' | 'unmatched';
}

/** The slice of the DeepID client the cohort needs — kept narrow for tests. */
export interface CohortUsersClient {
  iterateUsers(options?: { pageSize?: number; filteredTokenScopes?: string }): AsyncGenerator<UsersPage, void, void>;
}

export interface BuildCommunityCohortInput {
  /** Platform name; doubles as the DeepID consent scope and user field name. */
  platform: string;
  /** Platform-side community id — the Discord guild id — for the member lookup. */
  communityId: string;
  adapter: CommunityAdapter;
  deepId: CohortUsersClient;
  /** Proves liveness; called once per DeepID page and once per member lookup. */
  heartbeat: () => void;
  logger: CommunityEngineLogger;
}

/**
 * Builds the consented cohort for one platform: every DeepID user who granted
 * the platform's consent scope, with their linked username matched to a
 * platform account through the adapter's exact member lookup. Only consented
 * users appear here; matching never joins by display name. Rows are sorted by
 * DID so the frozen `cohort.parquet` is deterministic for its fetch moment.
 */
export async function buildCommunityCohort(input: BuildCommunityCohortInput): Promise<CommunityCohortRow[]> {
  const { platform, communityId, adapter, deepId, heartbeat, logger } = input;

  const consented: Array<{ did: string; username: string | null }> = [];
  let scannedUsers = 0;
  for await (const page of deepId.iterateUsers({ filteredTokenScopes: `api ${platform}` })) {
    for (const [did, user] of Object.entries(page.users)) {
      scannedUsers += 1;
      if (!hasScope(user, platform)) {
        continue;
      }
      const identity = parseSocialIdentity(user[platform]);
      consented.push({ did, username: identity?.username ?? null });
    }
    heartbeat();
  }
  consented.sort((a, b) => a.did.localeCompare(b.did));

  const accountIdByUsername = new Map<string, string | null>();
  const rows: CommunityCohortRow[] = [];
  for (const { did, username } of consented) {
    let accountId: string | null = null;
    if (username !== null) {
      const cached = accountIdByUsername.get(username);
      accountId = cached !== undefined ? cached : await adapter.searchMemberId(communityId, username);
      accountIdByUsername.set(username, accountId);
    }
    rows.push({
      did,
      username,
      accountId,
      status: accountId === null ? 'unmatched' : 'matched',
    });
    heartbeat();
  }

  logger.info('Community cohort assembled', {
    platform,
    scannedUsers,
    consented: rows.length,
    matched: rows.filter((row) => row.status === 'matched').length,
  });

  return rows;
}

function hasScope(user: DeepIdUser, scope: string): boolean {
  return Array.isArray(user.scopes) && user.scopes.includes(scope);
}

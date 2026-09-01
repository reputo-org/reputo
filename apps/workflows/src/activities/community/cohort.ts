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
  const { platform, deepId, heartbeat, logger } = input;

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

  const accountIdByUsername = await resolveAccountIds(input, consented);
  const rows: CommunityCohortRow[] = consented.map(({ did, username }) => {
    const accountId = username === null ? null : (accountIdByUsername.get(username) ?? null);
    return { did, username, accountId, status: accountId === null ? 'unmatched' : 'matched' };
  });

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

/**
 * Looks every distinct consented username up on the platform. Adapters whose
 * API resolves usernames in bulk answer in one call per batch; the rest are
 * asked one username at a time. Either way each username costs one lookup.
 */
async function resolveAccountIds(
  input: BuildCommunityCohortInput,
  consented: ReadonlyArray<{ username: string | null }>,
): Promise<Map<string, string | null>> {
  const { adapter, communityId, heartbeat } = input;
  const usernames = [...new Set(consented.map((entry) => entry.username).filter((name) => name !== null))];

  if (adapter.searchMemberIds !== undefined) {
    const resolved = await adapter.searchMemberIds(communityId, usernames);
    heartbeat();
    return resolved;
  }

  const resolved = new Map<string, string | null>();
  for (const username of usernames) {
    resolved.set(username, await adapter.searchMemberId(communityId, username));
    heartbeat();
  }
  return resolved;
}

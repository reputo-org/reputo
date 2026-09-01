import type { CommunityHttpObserver, CommunityLogger } from '../shared/http.js';
import type { CommunityAdapter } from '../shared/records.js';
import { createMattermostClient } from './client.js';
import { createMattermostRecordIterator } from './fetch.js';
import { createMattermostRequest } from './request.js';
import { toAccountIdsByUsername } from './transform.js';
import type { MattermostAdapterConfig, MattermostRawUser } from './types.js';

/** Usernames per bulk `/users/usernames` lookup. */
const USERNAME_LOOKUP_CHUNK = 100;

/**
 * The Mattermost implementation of the community platform adapter — the read
 * side only. `iterateRecords` carries no community id, so the team and its
 * token are bound at construction: one adapter per snapshot fetch. The token is
 * unsealed by the caller and lives only as long as this adapter.
 *
 * Listing and probing are the connect client's, so a connection is judged by
 * exactly the same code before and during a snapshot.
 */
export function createMattermostAdapter(
  config: MattermostAdapterConfig,
  logger: CommunityLogger,
  observer?: CommunityHttpObserver,
): CommunityAdapter {
  const request = createMattermostRequest(config, logger);
  const client = createMattermostClient(config, logger);
  const { target } = config;

  /**
   * Usernames are unique on a server, so one bulk lookup resolves a whole batch
   * exactly — a username the server does not answer for stays unmatched rather
   * than falling back to a near match.
   */
  const resolveUsernames = async (usernames: readonly string[]): Promise<Map<string, string | null>> => {
    const resolved = new Map<string, string | null>();
    for (let index = 0; index < usernames.length; index += USERNAME_LOOKUP_CHUNK) {
      const chunk = usernames.slice(index, index + USERNAME_LOOKUP_CHUNK);
      const response = await request<MattermostRawUser[]>(target, 'POST', '/users/usernames', chunk, observer);
      for (const [name, accountId] of toAccountIdsByUsername(response.data ?? [], chunk)) {
        resolved.set(name, accountId);
      }
    }
    return resolved;
  };

  return {
    platform: 'mattermost',

    listResources: () => client.listResources(target),

    probe: () => client.probe(target),

    iterateRecords: createMattermostRecordIterator({ request, target, logger, observer }),

    searchMemberId: async (_communityId, username) => (await resolveUsernames([username])).get(username) ?? null,

    searchMemberIds: (_communityId, usernames) => resolveUsernames(usernames),
  };
}

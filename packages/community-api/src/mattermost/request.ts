import { CommunityContractError } from '../shared/errors.js';
import type { CommunityHttpObserver, CommunityLogger, HttpMethod, HttpResponse } from '../shared/http.js';
import { executeSafeRequest } from '../shared/safe-fetch.js';
import { normalizeMattermostServerUrl } from './transform.js';
import { MATTERMOST_API_PATH, type MattermostClientConfig, type MattermostConnectionTarget } from './types.js';

/** One policed Mattermost v4 call. `body` is sent as JSON when present. */
export type MattermostRequest = <T>(
  target: MattermostConnectionTarget,
  method: HttpMethod,
  path: string,
  body?: unknown,
  observer?: CommunityHttpObserver,
) => Promise<HttpResponse<T>>;

/**
 * The single outbound path for Mattermost: every call of both the connect
 * client and the crawl adapter funnels through here and thus through
 * `executeSafeRequest`, so no code path can reach an unpoliced socket.
 */
export function createMattermostRequest(config: MattermostClientConfig, logger: CommunityLogger): MattermostRequest {
  return async <T>(
    target: MattermostConnectionTarget,
    method: HttpMethod,
    path: string,
    body?: unknown,
    observer?: CommunityHttpObserver,
  ): Promise<HttpResponse<T>> => {
    const origin = normalizeMattermostServerUrl(target.serverUrl);
    const headers: Record<string, string> = { authorization: `Bearer ${target.token}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    try {
      return await executeSafeRequest<T>(
        logger,
        config,
        config.outbound,
        {
          method,
          url: `${origin}${MATTERMOST_API_PATH}${path}`,
          headers,
          ...(body !== undefined && { body: JSON.stringify(body) }),
        },
        observer,
      );
    } catch (error) {
      // A non-Mattermost server answers with HTML; surface that as a contract
      // failure instead of a JSON parse error that quotes the body.
      if (error instanceof SyntaxError) {
        throw new CommunityContractError('The server did not answer with Mattermost API JSON; check the URL.');
      }
      throw error;
    }
  };
}

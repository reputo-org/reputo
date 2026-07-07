import type { DeepIdRequester } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { GetUsersOptions, UsersPage, UsersResponse } from './types.js';

function readNextCursor(headers: Record<string, string | string[] | undefined>): string | undefined {
  const header = headers['x-next'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Streams `GET /v1/users` page by page, following the `x-next` cursor until it
 * is absent. The cursor expires after 5 minutes, so callers must not pause
 * between pages for longer than that.
 */
export async function* iterateUsers(
  requester: DeepIdRequester,
  options?: GetUsersOptions,
): AsyncGenerator<UsersPage, void, void> {
  const pageSize = options?.pageSize ?? requester.config.defaultPageSize;
  let next: string | undefined;

  do {
    const params: Record<string, string | number> = { pageSize };
    if (next) {
      params.next = next;
    }
    if (options?.filteredTokenScopes) {
      params.filteredTokenScopes = options.filteredTokenScopes;
    }

    const response = await requester.request<UsersResponse>('GET', endpoints.users(), { params });
    next = readNextCursor(response.headers);
    yield { users: response.data ?? {}, next };
  } while (next);
}

/** Walks every page and returns the merged `did:sub:…` → user map. */
export async function getUsers(requester: DeepIdRequester, options?: GetUsersOptions): Promise<UsersResponse> {
  const all: UsersResponse = {};
  for await (const page of iterateUsers(requester, options)) {
    Object.assign(all, page.users);
  }
  return all;
}

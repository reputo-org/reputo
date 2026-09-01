import { CommunityHttpError, CommunityPermissionError, toErrorCategory } from '../shared/errors.js';
import type { CommunityHttpObserver, CommunityLogger } from '../shared/http.js';
import {
  type CommunityActivityRecord,
  CommunityCoverageStatus,
  type CommunityRecordBatch,
  type CommunityResourceCoverage,
  type IterateRecordsRequest,
} from '../shared/records.js';
import type { MattermostRequest } from './request.js';
import { toMattermostActivityRecords, toMattermostPostPage, toMattermostUsers, toScoreablePost } from './transform.js';
import type { MattermostRawPost, MattermostRawPostList, MattermostRawUser, MattermostTeamTarget } from './types.js';

/** Posts per history page. 200 is Mattermost's maximum for this endpoint. */
export const MATTERMOST_POSTS_PER_PAGE = 200;

/** Accounts per bulk `/users/ids` lookup. */
export const MATTERMOST_USER_LOOKUP_CHUNK = 100;

export interface MattermostFetchContext {
  request: MattermostRequest;
  target: MattermostTeamTarget;
  logger: CommunityLogger;
  observer?: CommunityHttpObserver;
}

/**
 * Resume position inside one channel crawl, carried opaquely through
 * `CommunityRecordBatch.cursor`: the oldest post the walk has read. Absent
 * before the first page. A resume re-walks the page it names — the engine's
 * identity dedup makes the overlap harmless.
 */
interface MattermostResourceCursor {
  before?: string;
}

function parseCursor(logger: CommunityLogger, cursor: string | undefined): MattermostResourceCursor {
  if (cursor === undefined) {
    return {};
  }
  try {
    const parsed = JSON.parse(cursor) as MattermostResourceCursor;
    if (parsed.before === undefined || typeof parsed.before === 'string') {
      return parsed;
    }
  } catch {
    // Fall through to a clean restart below.
  }
  logger.warn({ msg: 'Mattermost resume cursor is not readable; restarting the resource crawl' });
  return {};
}

const encodeCursor = (cursor: MattermostResourceCursor): string => JSON.stringify(cursor);

/**
 * The oldest post of one page, by creation time. The walk continues from it
 * whether or not the post is scoreable: a page of nothing but join and leave
 * notices still has to advance, or a busy channel's history would end there.
 */
function oldestPost(posts: readonly MattermostRawPost[]): { id: string; createdMs: number } | undefined {
  let oldest: { id: string; createdMs: number } | undefined;
  for (const post of posts) {
    const { id, create_at: createAt } = post;
    if (typeof id !== 'string' || id === '' || typeof createAt !== 'number' || !Number.isFinite(createAt)) {
      continue;
    }
    if (oldest === undefined || createAt < oldest.createdMs) {
      oldest = { id, createdMs: createAt };
    }
  }
  return oldest;
}

/** Permanent for one channel: the bot lost access, or the channel is gone. */
function isResourceScopedError(error: unknown): boolean {
  return error instanceof CommunityPermissionError || (error instanceof CommunityHttpError && error.statusCode === 404);
}

/**
 * The `is_bot` flag of every account the crawl credits, resolved in bulk and
 * cached for the whole run. An account the server does not answer for
 * (deactivated, deleted) is remembered as human, so it is asked for once.
 */
function createBotResolver(ctx: MattermostFetchContext) {
  const botByAccountId = new Map<string, boolean>();

  return {
    async prime(accountIds: Iterable<string>): Promise<void> {
      const unknown = [...new Set(accountIds)].filter((id) => !botByAccountId.has(id));
      for (let index = 0; index < unknown.length; index += MATTERMOST_USER_LOOKUP_CHUNK) {
        const chunk = unknown.slice(index, index + MATTERMOST_USER_LOOKUP_CHUNK);
        const response = await ctx.request<MattermostRawUser[]>(ctx.target, 'POST', '/users/ids', chunk, ctx.observer);
        for (const user of toMattermostUsers(response.data ?? [])) {
          if (typeof user?.id === 'string' && user.id !== '') {
            botByAccountId.set(user.id, user.is_bot === true);
          }
        }
      }
      for (const id of unknown) {
        if (!botByAccountId.has(id)) {
          botByAccountId.set(id, false);
        }
      }
    },

    isBot: (userId: string): boolean => botByAccountId.get(userId) === true,
  };
}

/**
 * Crawls one channel into canonical rows, newest page first, continuing from
 * the oldest post read so far until a post predates the window start.
 *
 * The walk is keyset-paginated on `before=<post id>`, not offset- or
 * `since`-paginated: `since` ignores `per_page` and truncates to an unordered
 * 1000-row slice server-side, which would silently drop activity from any busy
 * channel, and offset pages shift under posts that arrive mid-crawl. Rows are
 * then kept or dropped on their own defining timestamps.
 */
export function createMattermostRecordIterator(ctx: MattermostFetchContext) {
  const bots = createBotResolver(ctx);

  return async function* iterateRecords(
    request: IterateRecordsRequest,
  ): AsyncGenerator<CommunityRecordBatch, CommunityResourceCoverage> {
    const { resourceId, window } = request;
    const windowStartMs = Date.parse(window.start);
    let cursor = parseCursor(ctx.logger, request.cursor);
    // A resume cursor proves earlier pages were read, so a later permanent
    // failure downgrades to partial coverage instead of failed.
    let progressProven = cursor.before !== undefined;

    const coverage = (status: CommunityCoverageStatus, reason?: string): CommunityResourceCoverage => ({
      resource: resourceId,
      status,
      ...(reason !== undefined && { reason }),
    });

    const pathFor = ({ before }: MattermostResourceCursor): string => {
      const query = new URLSearchParams({ per_page: String(MATTERMOST_POSTS_PER_PAGE) });
      if (before === undefined) {
        query.set('page', '0');
      } else {
        query.set('before', before);
      }
      return `/channels/${encodeURIComponent(resourceId)}/posts?${query.toString()}`;
    };

    for (;;) {
      let payload: MattermostRawPostList;
      try {
        const response = await ctx.request<MattermostRawPostList>(
          ctx.target,
          'GET',
          pathFor(cursor),
          undefined,
          ctx.observer,
        );
        payload = response.data ?? {};
      } catch (error) {
        if (!isResourceScopedError(error)) {
          throw error;
        }
        // An uninvited private channel answers here: recorded as coverage,
        // never as an absence of activity.
        return progressProven
          ? coverage(CommunityCoverageStatus.partial, `posts:${toErrorCategory(error)}`)
          : coverage(CommunityCoverageStatus.failed, toErrorCategory(error));
      }
      progressProven = true;

      const page = toMattermostPostPage(payload);
      const scoreable = page.posts.flatMap((raw) => {
        const post = toScoreablePost(raw);
        return post === undefined ? [] : [{ raw, post }];
      });

      const accountIds = new Set<string>();
      for (const { post } of scoreable) {
        accountIds.add(post.userId);
        const root = post.rootId === null ? undefined : toScoreablePost(page.byId.get(post.rootId));
        if (root !== undefined) {
          accountIds.add(root.userId);
        }
      }
      await bots.prime(accountIds);

      const records: CommunityActivityRecord[] = [];
      for (const { raw, post } of scoreable) {
        records.push(...toMattermostActivityRecords(post, raw, page, resourceId, window, bots.isBot));
      }
      const oldest = oldestPost(page.posts);

      // The walk ends on a page it cannot continue from — an empty one, or one
      // already read — on a short page, which only a channel out of history
      // returns, and on the first post older than the window start, since
      // everything before that post is older still.
      const done =
        oldest === undefined ||
        oldest.createdMs < windowStartMs ||
        oldest.id === cursor.before ||
        page.posts.length < MATTERMOST_POSTS_PER_PAGE;
      // The cursor names where the crawl continues, so it may only advance once
      // this page's rows have been yielded.
      cursor = oldest === undefined ? cursor : { before: oldest.id };
      yield { records, cursor: encodeCursor(cursor) };
      if (done) {
        return coverage(CommunityCoverageStatus.complete);
      }
    }
  };
}

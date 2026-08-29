import { CommunityHttpError, CommunityPermissionError, toErrorCategory } from '../shared/errors.js';
import { type CommunityHttpObserver, type CommunityLogger, executeRequest } from '../shared/http.js';
import {
  type CommunityActivityRecord,
  CommunityCoverageStatus,
  type CommunityRecordBatch,
  type CommunityResourceCoverage,
  type IterateRecordsRequest,
} from '../shared/records.js';
import {
  type DiscordChannelMeta,
  snowflakeForTimestamp,
  toActivityRecords,
  toChannelMeta,
  toCrawlableThreads,
} from './transform.js';
import {
  DISCORD_API_BASE_URL,
  type DiscordAdapterConfig,
  type DiscordRawActiveThreadsResponse,
  type DiscordRawArchivedThreadsResponse,
  type DiscordRawChannel,
  type DiscordRawMessage,
  type DiscordRawThread,
} from './types.js';

const MESSAGES_PAGE_LIMIT = 100;
const ARCHIVED_THREADS_PAGE_LIMIT = 100;

export interface DiscordFetchContext {
  config: DiscordAdapterConfig;
  logger: CommunityLogger;
  observer?: CommunityHttpObserver;
}

/**
 * Resume position inside one resource crawl, carried opaquely through
 * `CommunityRecordBatch.cursor`. The `messages` phase resumes at page
 * granularity (`before` message id); the `threads` phase resumes at archived
 * page granularity (`archivedBefore` archive timestamp) and re-walks the
 * page's threads — the engine's identity dedup makes the overlap harmless.
 */
interface DiscordResourceCursor {
  phase: 'messages' | 'threads';
  before?: string;
  archivedBefore?: string;
}

function parseCursor(logger: CommunityLogger, cursor: string | undefined): DiscordResourceCursor {
  if (cursor === undefined) {
    return { phase: 'messages' };
  }
  try {
    const parsed = JSON.parse(cursor) as DiscordResourceCursor;
    if (parsed.phase === 'messages' || parsed.phase === 'threads') {
      return parsed;
    }
  } catch {
    // Fall through to a clean restart below.
  }
  logger.warn({ msg: 'Discord resume cursor is not readable; restarting the resource crawl' });
  return { phase: 'messages' };
}

const encodeCursor = (cursor: DiscordResourceCursor): string => JSON.stringify(cursor);

/** Permanent for one resource: the bot lost access, or the object is gone. */
function isResourceScopedError(error: unknown): boolean {
  return error instanceof CommunityPermissionError || (error instanceof CommunityHttpError && error.statusCode === 404);
}

interface MessagePageOutcome {
  records: CommunityActivityRecord[];
  /** `before` id for the next page; undefined when pagination cannot continue. */
  nextBefore?: string;
  done: boolean;
}

/**
 * Turns one messages page (newest first) into canonical rows and the walk
 * decision: stop once a message predates the window start or the page is
 * short. Rows are window-filtered per their own defining timestamps.
 */
export function processMessagePage(
  page: readonly DiscordRawMessage[],
  resourceId: string,
  window: IterateRecordsRequest['window'],
): MessagePageOutcome {
  const windowStartMs = Date.parse(window.start);
  const records: CommunityActivityRecord[] = [];
  let reachedWindowStart = false;
  let lastId: string | undefined;

  for (const message of page) {
    if (typeof message?.id === 'string') {
      lastId = message.id;
    }
    const createdMs = typeof message?.timestamp === 'string' ? Date.parse(message.timestamp) : Number.NaN;
    if (!Number.isNaN(createdMs) && createdMs < windowStartMs) {
      reachedWindowStart = true;
      break;
    }
    records.push(...toActivityRecords(message, resourceId, window));
  }

  return {
    records,
    nextBefore: lastId,
    done: reachedWindowStart || page.length < MESSAGES_PAGE_LIMIT || lastId === undefined,
  };
}

export function createDiscordRecordIterator(
  ctx: DiscordFetchContext,
  activeThreadsByGuild: Map<string, Promise<DiscordRawThread[]>>,
) {
  const botHeaders = { authorization: `Bot ${ctx.config.botToken}` };
  const get = async <T>(url: string): Promise<T> => {
    const response = await executeRequest<T>(
      ctx.logger,
      ctx.config,
      { method: 'GET', url, headers: botHeaders },
      ctx.observer,
    );
    return response.data;
  };

  const fetchMessagePage = (channelId: string, before: string): Promise<DiscordRawMessage[]> =>
    get<DiscordRawMessage[]>(
      `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(channelId)}/messages?limit=${MESSAGES_PAGE_LIMIT}&before=${encodeURIComponent(before)}`,
    ).then((page) => (Array.isArray(page) ? page : []));

  const fetchActiveThreads = (guildId: string): Promise<DiscordRawThread[]> => {
    let pending = activeThreadsByGuild.get(guildId);
    if (!pending) {
      pending = get<DiscordRawActiveThreadsResponse>(
        `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(guildId)}/threads/active`,
      ).then((response) => (Array.isArray(response?.threads) ? (response.threads as DiscordRawThread[]) : []));
      // One guild-wide listing serves every selected channel; a failed fetch is
      // evicted so the next resource (or retry) can try again.
      activeThreadsByGuild.set(guildId, pending);
      pending.catch(() => activeThreadsByGuild.delete(guildId));
    }
    return pending;
  };

  return async function* iterateRecords(
    request: IterateRecordsRequest,
  ): AsyncGenerator<CommunityRecordBatch, CommunityResourceCoverage> {
    const { resourceId, window } = request;
    const cursor = parseCursor(ctx.logger, request.cursor);
    const partialReasons: string[] = [];
    // A resume cursor proves earlier pages were read, so later permanent
    // failures downgrade to partial coverage instead of failed.
    let progressProven = request.cursor !== undefined;

    const coverage = (status: CommunityCoverageStatus, reason?: string): CommunityResourceCoverage => ({
      resource: resourceId,
      status,
      ...(reason !== undefined && { reason }),
    });
    const finish = (): CommunityResourceCoverage =>
      partialReasons.length > 0
        ? coverage(CommunityCoverageStatus.partial, partialReasons.join('; '))
        : coverage(CommunityCoverageStatus.complete);

    let meta: DiscordChannelMeta | undefined;
    try {
      const channel = await get<DiscordRawChannel>(
        `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(resourceId)}`,
      );
      meta = toChannelMeta(channel);
    } catch (error) {
      if (!isResourceScopedError(error)) {
        throw error;
      }
      return progressProven
        ? coverage(CommunityCoverageStatus.partial, `channel:${toErrorCategory(error)}`)
        : coverage(CommunityCoverageStatus.failed, toErrorCategory(error));
    }
    if (meta === undefined) {
      return coverage(CommunityCoverageStatus.failed, 'unsupported_resource');
    }

    async function* crawlThreadMessages(
      threadId: string,
      threadCursor: DiscordResourceCursor,
    ): AsyncGenerator<CommunityRecordBatch> {
      let before = snowflakeForTimestamp(window.end);
      for (;;) {
        let page: DiscordRawMessage[];
        try {
          page = await fetchMessagePage(threadId, before);
        } catch (error) {
          if (!isResourceScopedError(error)) {
            throw error;
          }
          partialReasons.push(`thread:${toErrorCategory(error)}`);
          return;
        }
        progressProven = true;
        const outcome = processMessagePage(page, resourceId, window);
        yield { records: outcome.records, cursor: encodeCursor(threadCursor) };
        if (outcome.done || outcome.nextBefore === undefined) {
          return;
        }
        before = outcome.nextBefore;
      }
    }

    // Phase 1 — the channel's own message history. Forum channels have none;
    // their posts are threads and are crawled in phase 2.
    if (cursor.phase === 'messages' && meta.kind !== 'forum') {
      let before = cursor.before ?? snowflakeForTimestamp(window.end);
      for (;;) {
        let page: DiscordRawMessage[];
        try {
          page = await fetchMessagePage(resourceId, before);
        } catch (error) {
          if (!isResourceScopedError(error)) {
            throw error;
          }
          if (!progressProven) {
            return coverage(CommunityCoverageStatus.failed, toErrorCategory(error));
          }
          partialReasons.push(`messages:${toErrorCategory(error)}`);
          break;
        }
        progressProven = true;
        const outcome = processMessagePage(page, resourceId, window);
        if (outcome.done || outcome.nextBefore === undefined) {
          yield { records: outcome.records, cursor: encodeCursor({ phase: 'threads' }) };
          break;
        }
        before = outcome.nextBefore;
        yield { records: outcome.records, cursor: encodeCursor({ phase: 'messages', before }) };
      }
    }

    // Phase 2 — threads. Active threads are listed guild-wide once and re-walked
    // in full on resume; archived pages advance the cursor as they complete.
    const windowStartMs = Date.parse(window.start);
    if (cursor.archivedBefore === undefined) {
      let activeThreads: DiscordRawThread[] = [];
      try {
        activeThreads = await fetchActiveThreads(meta.guildId);
      } catch (error) {
        if (!isResourceScopedError(error)) {
          throw error;
        }
        partialReasons.push(`active_threads:${toErrorCategory(error)}`);
      }
      for (const thread of toCrawlableThreads(activeThreads, resourceId)) {
        yield* crawlThreadMessages(thread.id, { phase: 'threads' });
      }
    }

    let archivedBefore = cursor.archivedBefore;
    for (;;) {
      const beforeQuery = archivedBefore === undefined ? '' : `&before=${encodeURIComponent(archivedBefore)}`;
      let listing: DiscordRawArchivedThreadsResponse;
      try {
        listing = await get<DiscordRawArchivedThreadsResponse>(
          `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(resourceId)}/threads/archived/public?limit=${ARCHIVED_THREADS_PAGE_LIMIT}${beforeQuery}`,
        );
      } catch (error) {
        if (!isResourceScopedError(error)) {
          throw error;
        }
        partialReasons.push(`archived_threads:${toErrorCategory(error)}`);
        break;
      }
      progressProven = true;

      const threads = toCrawlableThreads(listing?.threads, resourceId);
      let oldestArchiveMs = Number.POSITIVE_INFINITY;
      let oldestArchiveIso: string | undefined;
      for (const thread of threads) {
        const archiveMs = thread.archiveTimestamp === undefined ? Number.NaN : Date.parse(thread.archiveTimestamp);
        if (!Number.isNaN(archiveMs) && archiveMs < oldestArchiveMs) {
          oldestArchiveMs = archiveMs;
          oldestArchiveIso = thread.archiveTimestamp;
        }
        // A thread archived before the window start went quiet before the
        // window opened; its messages cannot be inside it.
        if (Number.isNaN(archiveMs) || archiveMs >= windowStartMs) {
          yield* crawlThreadMessages(thread.id, { phase: 'threads', archivedBefore });
        }
      }

      const pastWindow = oldestArchiveMs < windowStartMs;
      // A page that cannot move the boundary back must end the walk, or a
      // malformed listing would loop forever.
      const stuck = oldestArchiveIso === undefined || oldestArchiveIso === archivedBefore;
      const done = listing?.has_more !== true || pastWindow || stuck;
      archivedBefore = oldestArchiveIso ?? archivedBefore;
      yield {
        records: [],
        cursor: encodeCursor({ phase: 'threads', archivedBefore }),
      };
      if (done) {
        break;
      }
    }

    return finish();
  };
}

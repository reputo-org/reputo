import { CommunityHttpError, CommunityPermissionError, toErrorCategory } from '../shared/errors.js';
import type { CommunityLogger } from '../shared/http.js';
import {
  type CommunityActivityRecord,
  CommunityCoverageStatus,
  type CommunityFetchWindow,
  type CommunityRecordBatch,
  type CommunityResourceCoverage,
  type IterateRecordsRequest,
} from '../shared/records.js';
import type { GitHubApi } from './auth.js';
import { pullRequestNumber, toCommentRecords, toIssueRecords, toReviewRecords } from './transform.js';
import type { GitHubRawIssue } from './types.js';

const PAGE_LIMIT = 100;

export interface GitHubFetchContext {
  api: GitHubApi;
  installationId: string;
  logger: CommunityLogger;
  /** Resolves a selected repository id to its `owner/name`, or undefined when the installation lost it. */
  resolveRepository(resourceId: string): Promise<string | undefined>;
}

/**
 * Resume position inside one repository crawl, carried opaquely through
 * `CommunityRecordBatch.cursor`. Each phase resumes at page granularity and
 * re-walks the page it stopped on — the engine's identity dedup makes the
 * overlap harmless. A pull request's reviews are read while its issues page is
 * walked, so they need no phase of their own.
 */
const GitHubCrawlPhase = {
  issues: 'issues',
  issueComments: 'issue_comments',
  reviewComments: 'review_comments',
} as const;

type GitHubCrawlPhase = (typeof GitHubCrawlPhase)[keyof typeof GitHubCrawlPhase];

/** Phases in crawl order; a resume continues at its phase and finishes the rest. */
const CRAWL_PHASES: readonly GitHubCrawlPhase[] = [
  GitHubCrawlPhase.issues,
  GitHubCrawlPhase.issueComments,
  GitHubCrawlPhase.reviewComments,
];

interface GitHubResourceCursor {
  phase: GitHubCrawlPhase;
  page: number;
}

function parseCursor(logger: CommunityLogger, cursor: string | undefined): GitHubResourceCursor {
  if (cursor === undefined) {
    return { phase: GitHubCrawlPhase.issues, page: 1 };
  }
  try {
    const parsed = JSON.parse(cursor) as GitHubResourceCursor;
    if (CRAWL_PHASES.includes(parsed.phase) && Number.isInteger(parsed.page) && parsed.page >= 1) {
      return parsed;
    }
  } catch {
    // Fall through to a clean restart below.
  }
  logger.warn({ msg: 'GitHub resume cursor is not readable; restarting the resource crawl' });
  return { phase: GitHubCrawlPhase.issues, page: 1 };
}

const encodeCursor = (cursor: GitHubResourceCursor): string => JSON.stringify(cursor);

/** Permanent for one repository: the App lost access, the repo is gone, or issues are disabled. */
function isResourceScopedError(error: unknown): boolean {
  return (
    error instanceof CommunityPermissionError ||
    (error instanceof CommunityHttpError && (error.statusCode === 404 || error.statusCode === 410))
  );
}

const listPath = (repository: string, resource: string, query: Record<string, string>): string =>
  `/repos/${repository}/${resource}?${new URLSearchParams({ per_page: String(PAGE_LIMIT), ...query }).toString()}`;

/**
 * Crawls one repository into canonical rows. Listings are ordered by their
 * oldest update first and filtered by `since`, so a pull request opened before
 * the window but merged inside it is listed again and credited by its merge
 * time; every row is then kept or dropped on its own defining timestamp.
 */
export function createGitHubRecordIterator(ctx: GitHubFetchContext) {
  const get = <T>(path: string): Promise<T> => ctx.api.installationRequest<T>(ctx.installationId, 'GET', path);

  /** Every review of one pull request, as rows credited to their reviewers. */
  const fetchReviewRecords = async (
    repository: string,
    issue: GitHubRawIssue,
    resourceId: string,
    window: CommunityFetchWindow,
  ): Promise<CommunityActivityRecord[]> => {
    const number = pullRequestNumber(issue);
    if (number === undefined) {
      return [];
    }

    const authorId = typeof issue.user?.id === 'number' ? String(issue.user.id) : null;
    const records: CommunityActivityRecord[] = [];
    for (let page = 1; ; page++) {
      const reviews = await get<unknown[]>(listPath(repository, `pulls/${number}/reviews`, { page: String(page) }));
      const batch = Array.isArray(reviews) ? reviews : [];
      records.push(...toReviewRecords(batch, resourceId, window, authorId));
      if (batch.length < PAGE_LIMIT) {
        return records;
      }
    }
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

    let resolved: string | undefined;
    try {
      resolved = await ctx.resolveRepository(resourceId);
    } catch (error) {
      if (!isResourceScopedError(error)) {
        throw error;
      }
      return coverage(CommunityCoverageStatus.failed, toErrorCategory(error));
    }
    if (resolved === undefined) {
      // The installation no longer carries this repository — removed from the
      // App, deleted, or transferred away since the preset selected it.
      return coverage(CommunityCoverageStatus.failed, 'not_found');
    }
    const repository = resolved;

    const pathFor = (phase: GitHubCrawlPhase, page: number): string => {
      const since = { since: window.start, page: String(page) };
      if (phase === GitHubCrawlPhase.issues) {
        return listPath(repository, 'issues', { ...since, state: 'all', sort: 'updated', direction: 'asc' });
      }
      const resource = phase === GitHubCrawlPhase.issueComments ? 'issues/comments' : 'pulls/comments';
      return listPath(repository, resource, { ...since, sort: 'created', direction: 'asc' });
    };

    for (const phase of CRAWL_PHASES.slice(CRAWL_PHASES.indexOf(cursor.phase))) {
      let page = phase === cursor.phase ? cursor.page : 1;
      for (;;) {
        let items: unknown[];
        try {
          const response = await get<unknown[]>(pathFor(phase, page));
          items = Array.isArray(response) ? response : [];
        } catch (error) {
          if (!isResourceScopedError(error)) {
            throw error;
          }
          if (!progressProven) {
            return coverage(CommunityCoverageStatus.failed, toErrorCategory(error));
          }
          partialReasons.push(`${phase}:${toErrorCategory(error)}`);
          break;
        }
        progressProven = true;

        const records: CommunityActivityRecord[] = [];
        if (phase === GitHubCrawlPhase.issues) {
          for (const issue of items as GitHubRawIssue[]) {
            records.push(...toIssueRecords(issue, resourceId, window));
            try {
              records.push(...(await fetchReviewRecords(repository, issue, resourceId, window)));
            } catch (error) {
              if (!isResourceScopedError(error)) {
                throw error;
              }
              partialReasons.push(`reviews:${toErrorCategory(error)}`);
            }
          }
        } else {
          records.push(...toCommentRecords(items, resourceId, window));
        }

        const done = items.length < PAGE_LIMIT;
        page += 1;
        // The cursor names where the crawl continues, so it may only advance
        // once this page's rows — reviews included — have been yielded.
        const next: GitHubResourceCursor = done
          ? { phase: CRAWL_PHASES[CRAWL_PHASES.indexOf(phase) + 1] ?? phase, page: 1 }
          : { phase, page };
        yield { records, cursor: encodeCursor(next) };
        if (done) {
          break;
        }
      }
    }

    return partialReasons.length > 0
      ? coverage(CommunityCoverageStatus.partial, partialReasons.join('; '))
      : coverage(CommunityCoverageStatus.complete);
  };
}

import { CommunityContractError } from '../shared/errors.js';
import {
  type CommunityActivityRecord,
  type CommunityFetchWindow,
  isWithinWindow,
  toUtcIso,
} from '../shared/records.js';
import type { CommunityResource } from '../shared/types.js';
import {
  CommunityGithubActivityType,
  GITHUB_APPS_BASE_URL,
  type GitHubInstallation,
  type GitHubRawComment,
  type GitHubRawInstallation,
  type GitHubRawIssue,
  type GitHubRawRepository,
  type GitHubRawReview,
  type GitHubRawUser,
} from './types.js';

export interface BuildGitHubInstallUrlParams {
  /** URL slug of the GitHub App. */
  slug: string;
  /** Signed, TTL-bounded value the caller mints and verifies on the callback. */
  state: string;
}

/**
 * App-install URL. GitHub redirects back to the App's configured setup URL with
 * the `installation_id` and this `state`; there is no `redirect_uri` parameter,
 * so the callback URL is App configuration the deployment must match.
 */
export function buildGitHubInstallUrl({ slug, state }: BuildGitHubInstallUrlParams): string {
  const url = new URL(`${GITHUB_APPS_BASE_URL}/${encodeURIComponent(slug)}/installations/new`);
  url.searchParams.set('state', state);
  return url.toString();
}

/** The installation an app-JWT confirmation returned, with the account it belongs to. */
export function toInstallation(raw: GitHubRawInstallation): GitHubInstallation {
  const id = raw?.id;
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new CommunityContractError('GitHub returned an installation without an id.');
  }

  const login = raw?.account?.login;
  return {
    id: String(id),
    account: typeof login === 'string' && login.length > 0 ? login : String(id),
  };
}

/**
 * Repositories the installation can read, keyed by their stable numeric id so a
 * rename cannot invalidate a saved preset. The full name is the display label.
 */
export function toRepositoryResources(repositories: unknown): CommunityResource[] {
  if (!Array.isArray(repositories)) {
    throw new CommunityContractError('GitHub repository listing was not an array.');
  }

  return (repositories as GitHubRawRepository[])
    .filter(
      (repository): repository is GitHubRawRepository & { id: number; full_name: string } =>
        typeof repository?.id === 'number' && typeof repository.full_name === 'string',
    )
    .map((repository) => ({ id: String(repository.id), name: repository.full_name, kind: 'repository' as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether a sampled issues page carries the fields the crawl depends on. An
 * empty page proves the App can read the repository and leaves the fields
 * unverified, which counts as present.
 */
export function hasRequiredIssueFields(issues: readonly GitHubRawIssue[]): boolean {
  return issues.every((issue) => typeof issue?.id === 'number' && typeof issue.created_at === 'string');
}

/** Pull requests are issues carrying the `pull_request` marker; everything else is an issue. */
export function isPullRequest(issue: GitHubRawIssue): boolean {
  return issue?.pull_request !== undefined && issue.pull_request !== null;
}

/** The pull request number a reviews call needs, or undefined for anything else. */
export function pullRequestNumber(issue: GitHubRawIssue): number | undefined {
  return isPullRequest(issue) && typeof issue.number === 'number' ? issue.number : undefined;
}

interface GitHubActor {
  id: string;
  isBot: boolean;
}

/**
 * The stable account id an activity is credited to. Deleted accounts arrive as
 * `null` or without an id and produce no row — the dataset never carries an
 * activity it cannot attribute.
 */
function toActor(user: GitHubRawUser | null | undefined): GitHubActor | undefined {
  return typeof user?.id === 'number' ? { id: String(user.id), isBot: user.type === 'Bot' } : undefined;
}

interface RecordDraft {
  type: string;
  actor: GitHubActor;
  counterparty?: string | null;
  objectId: string;
  occurredAt: string | undefined;
}

function toRecord(
  draft: RecordDraft,
  resourceId: string,
  window: CommunityFetchWindow,
): CommunityActivityRecord | undefined {
  if (draft.occurredAt === undefined || !isWithinWindow(draft.occurredAt, window)) {
    return undefined;
  }

  return {
    type: draft.type,
    actor: draft.actor.id,
    counterparty: draft.counterparty ?? null,
    resource: resourceId,
    objectId: draft.objectId,
    occurredAt: draft.occurredAt,
    count: 1,
    actorIsBot: draft.actor.isBot,
    deleted: false,
  };
}

/**
 * Maps one `/issues` row to its canonical rows. A pull request contributes
 * `pull_request_opened` at its creation time and `pull_request_merged` at its
 * merge time, both credited to the author — never to whoever merged it — so an
 * old pull request merged inside the window is scored by its merge alone.
 */
export function toIssueRecords(
  raw: GitHubRawIssue,
  resourceId: string,
  window: CommunityFetchWindow,
): CommunityActivityRecord[] {
  const actor = toActor(raw?.user);
  if (actor === undefined || typeof raw?.id !== 'number') {
    return [];
  }

  const objectId = String(raw.id);
  const createdAt = toUtcIso(raw.created_at);

  if (!isPullRequest(raw)) {
    const opened = toRecord(
      { type: CommunityGithubActivityType.issueOpened, actor, objectId, occurredAt: createdAt },
      resourceId,
      window,
    );
    return opened ? [opened] : [];
  }

  return [
    toRecord(
      { type: CommunityGithubActivityType.pullRequestOpened, actor, objectId, occurredAt: createdAt },
      resourceId,
      window,
    ),
    toRecord(
      {
        type: CommunityGithubActivityType.pullRequestMerged,
        actor,
        objectId,
        occurredAt: toUtcIso(raw.pull_request?.merged_at),
      },
      resourceId,
      window,
    ),
  ].filter((record): record is CommunityActivityRecord => record !== undefined);
}

/** Reviews still in progress carry no submission time and are not activity yet. */
const REVIEW_STATE_PENDING = 'PENDING';

/**
 * Maps a pull request's reviews to `pull_request_review` rows at their
 * submission time, with the pull request's author as the counterparty.
 */
export function toReviewRecords(
  reviews: unknown,
  resourceId: string,
  window: CommunityFetchWindow,
  pullRequestAuthorId: string | null,
): CommunityActivityRecord[] {
  if (!Array.isArray(reviews)) {
    return [];
  }

  const records: CommunityActivityRecord[] = [];
  for (const review of reviews as GitHubRawReview[]) {
    const actor = toActor(review?.user);
    if (actor === undefined || typeof review?.id !== 'number' || review.state === REVIEW_STATE_PENDING) {
      continue;
    }

    const record = toRecord(
      {
        type: CommunityGithubActivityType.pullRequestReview,
        actor,
        counterparty: pullRequestAuthorId,
        objectId: String(review.id),
        occurredAt: toUtcIso(review.submitted_at),
      },
      resourceId,
      window,
    );
    if (record) {
      records.push(record);
    }
  }
  return records;
}

/**
 * Maps issue comments and pull request review comments to `comment` rows at
 * their creation time. The listings are filtered by last update, so a comment
 * written before the window but edited inside it is read and then dropped here.
 */
export function toCommentRecords(
  comments: unknown,
  resourceId: string,
  window: CommunityFetchWindow,
): CommunityActivityRecord[] {
  if (!Array.isArray(comments)) {
    return [];
  }

  const records: CommunityActivityRecord[] = [];
  for (const comment of comments as GitHubRawComment[]) {
    const actor = toActor(comment?.user);
    if (actor === undefined || typeof comment?.id !== 'number') {
      continue;
    }

    const record = toRecord(
      {
        type: CommunityGithubActivityType.comment,
        actor,
        objectId: String(comment.id),
        occurredAt: toUtcIso(comment.created_at),
      },
      resourceId,
      window,
    );
    if (record) {
      records.push(record);
    }
  }
  return records;
}

/** The account id of the user whose login matches exactly — never a guess. */
export function toMatchedAccountId(user: GitHubRawUser | undefined, login: string): string | null {
  return typeof user?.id === 'number' && user.login === login ? String(user.id) : null;
}

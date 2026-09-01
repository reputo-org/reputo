import type { CommunityHttpConfig } from '../shared/types.js';

export const GITHUB_API_BASE_URL = 'https://api.github.com';
export const GITHUB_APPS_BASE_URL = 'https://github.com/apps';

/** Every call pins the REST version and the JSON media type the mappers assume. */
export const GITHUB_API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'reputo-community',
} as const;

/**
 * Activity types the GitHub crawl emits. `pull_request_merged` is credited to
 * the pull request's author, never to whoever pressed merge.
 */
export const CommunityGithubActivityType = {
  pullRequestOpened: 'pull_request_opened',
  pullRequestMerged: 'pull_request_merged',
  pullRequestReview: 'pull_request_review',
  issueOpened: 'issue_opened',
  comment: 'comment',
} as const;

export type CommunityGithubActivityType =
  (typeof CommunityGithubActivityType)[keyof typeof CommunityGithubActivityType];

/**
 * The GitHub App credentials every call starts from. The private key is
 * deployment configuration: it signs a short-lived app JWT, which mints the
 * installation tokens. Neither is ever persisted or logged.
 */
export interface GitHubAppConfig extends CommunityHttpConfig {
  appId: string;
  /** PEM-encoded RSA private key of the App. */
  privateKey: string;
}

/**
 * What the read side (adapter) needs. `iterateRecords` carries no community id,
 * so the installation the crawl reads is bound at construction — one adapter
 * per snapshot fetch.
 */
export interface GitHubAdapterConfig extends GitHubAppConfig {
  installationId: string;
}

export interface GitHubClientConfig extends GitHubAppConfig {
  /** URL slug of the App, used to build the install redirect. */
  slug: string;
  /** Absolute URL GitHub redirects the browser back to after the install. */
  callbackUrl: string;
}

/** The account (organization or user) a confirmed installation belongs to. */
export interface GitHubInstallation {
  id: string;
  account: string;
}

/**
 * Latest installation rate-limit snapshot the transport observed. The crawl
 * reports it next to the request count so a run can be read against the
 * installation's hourly budget.
 */
export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  /** Epoch seconds the current window resets at. */
  resetAt: number;
}

/** Raw shapes, narrowed before use — the transforms own the validation. */
export interface GitHubRawAccount {
  login?: unknown;
}

export interface GitHubRawInstallation {
  id?: unknown;
  account?: GitHubRawAccount | null;
}

export interface GitHubRawRepository {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  has_issues?: unknown;
}

export interface GitHubRawRepositoriesResponse {
  repositories?: unknown;
}

export interface GitHubRawUser {
  id?: unknown;
  login?: unknown;
  type?: unknown;
}

/** An `/issues` row: a plain issue, or a pull request carrying the `pull_request` marker. */
export interface GitHubRawIssue {
  id?: unknown;
  number?: unknown;
  user?: GitHubRawUser | null;
  created_at?: unknown;
  pull_request?: { merged_at?: unknown } | null;
}

export interface GitHubRawReview {
  id?: unknown;
  user?: GitHubRawUser | null;
  state?: unknown;
  submitted_at?: unknown;
}

export interface GitHubRawComment {
  id?: unknown;
  user?: GitHubRawUser | null;
  created_at?: unknown;
}

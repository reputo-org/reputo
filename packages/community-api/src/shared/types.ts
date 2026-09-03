import { createHash } from 'node:crypto';

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Transport settings every platform client shares. Injected, never read from the environment. */
export interface CommunityHttpConfig {
  requestTimeoutMs: number;
  retry: RetryConfig;
}

/** Canonical, platform-neutral kinds of a selectable resource. */
export type CommunityResourceKind = 'text' | 'announcement' | 'forum' | 'repository';

/**
 * Why the pipeline cannot read a listed resource. Mirrors the wire enum in
 * `@reputo/contracts`; the UI turns each value into the fix the admin makes.
 */
export const CommunityResourceAccessIssue = {
  /** Discord: the bot lacks View Channel on this channel. */
  missingViewChannel: 'missing_view_channel',
  /** Discord: the bot can see the channel but lacks Read Message History. */
  missingReadHistory: 'missing_read_history',
  /** GitHub: the repository has its issue tracker disabled, so there is nothing to score. */
  issuesDisabled: 'issues_disabled',
  /** Mattermost: the bot is not in the channel and the server refuses reads without membership. */
  notMember: 'not_member',
} as const;

export type CommunityResourceAccessIssue =
  (typeof CommunityResourceAccessIssue)[keyof typeof CommunityResourceAccessIssue];

/**
 * One selectable resource inside a connected community — a Discord channel, a
 * GitHub repository. `readable` is the platform's own verdict on whether the
 * pipeline can read it right now. An unreadable resource is still listed, with
 * the issue that blocks it, so a preset never selects it blind.
 */
export interface CommunityResource {
  id: string;
  name: string;
  kind: CommunityResourceKind;
  readable: boolean;
  accessIssue?: CommunityResourceAccessIssue;
}

/**
 * Display facts about a connected community — counts and public asset URLs
 * only, in keeping with the package rule of never touching content.
 */
export interface CommunityProfile {
  /** Public HTTPS icon URL, when the platform serves one unauthenticated. */
  avatarUrl?: string;
  /** Approximate member count, when one cheap call provides it. */
  memberCount?: number;
}

/**
 * Outcome of a successful capability probe: what the connection can list, how
 * much of it the pipeline can read, and which resource one page of history was
 * read from. A probe that resolves has already verified the fields the fetch
 * will later need.
 */
export interface CommunityProbeResult {
  resourceCount: number;
  /** Resources the pipeline can read under the bot's current access. */
  readableResourceCount: number;
  /** Fingerprint of the listing and its access verdicts; changes when either does. */
  resourcesDigest: string;
  /** Resource the probe read a page of history from, when one was readable. */
  sampledResourceId?: string;
  sampledRecordCount: number;
  /** Best-effort display facts; absent when the extra call failed. */
  profile?: CommunityProfile;
}

/** Order-independent fingerprint of which resources exist and which are readable. Ids only, never names. */
export function digestCommunityResources(resources: readonly CommunityResource[]): string {
  const hash = createHash('sha256');
  for (const resource of [...resources].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(`${resource.id}:${resource.readable ? 1 : 0}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}

export const DEFAULT_HTTP_CONFIG: CommunityHttpConfig = {
  requestTimeoutMs: 15_000,
  retry: {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
  },
};

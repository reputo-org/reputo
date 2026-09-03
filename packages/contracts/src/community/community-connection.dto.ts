import type {
  CommunityConnectionStatus,
  CommunityFeedState,
  CommunityPlatform,
  CommunityResourceAccessIssue,
  CommunityResourceKind,
} from '../enums/community.js';

/**
 * Display facts the last successful probe captured — counts and public asset
 * URLs only, never content. Fields go stale together with `lastCheckedAt`.
 */
export interface CommunityConnectionMetadataDto {
  /** Public HTTPS icon URL, when the platform serves one unauthenticated. */
  avatarUrl?: string;
  /** Approximate member count reported by the platform. */
  memberCount?: number;
  /** Selectable resources the probe counted — channels, repositories. */
  resourceCount?: number;
  /** Of those, the resources the pipeline can read under the bot's current access. */
  readableResourceCount?: number;
}

/**
 * Wire DTO for a community connection. JSON-serializable; dates are ISO 8601
 * strings.
 *
 * Credentials never appear here. The sealed credential column exists on the
 * entity only, and no field of this DTO is derived from it.
 */
export interface CommunityConnectionDto {
  id: string;
  platform: CommunityPlatform;
  /** Platform-side identifier of the connected community — a Discord guild id. */
  externalId: string;
  name: string;
  status: CommunityConnectionStatus;
  /**
   * Safe category of the most recent failed check, present while the
   * connection is not active. Never carries a platform response body.
   */
  statusReason?: string;
  /**
   * When the platform last confirmed this state. Health is checked on connect,
   * on demand, per snapshot, and whenever the platform's live feed reports a
   * change.
   */
  lastCheckedAt?: string;
  /** Present once a probe has succeeded; kept across later failed probes. */
  metadata?: CommunityConnectionMetadataDto;
  createdAt: string;
  updatedAt: string;
}

/**
 * One selectable resource inside a connected community — a Discord channel, a
 * GitHub repository. Unreadable resources are listed too, with the issue that
 * blocks them, so a preset can show what the bot cannot reach.
 */
export interface CommunityResourceDto {
  id: string;
  name: string;
  /** Canonical resource kind, platform-neutral. */
  kind: CommunityResourceKind;
  /** Whether the pipeline can read this resource under the bot's current access. */
  readable: boolean;
  /** Why the resource is unreadable; absent when it is readable. */
  accessIssue?: CommunityResourceAccessIssue;
}

/** Result of an on-demand capability probe. */
export interface CommunityHealthDto {
  status: CommunityConnectionStatus;
  checkedAt: string;
  /** Human-readable reason when the probe did not succeed. */
  reason?: string;
}

/** A connection row changed — status, reason, metadata, or name. */
export interface CommunityConnectionUpdatedEventDto {
  type: 'community_connection:updated';
  data: CommunityConnectionDto;
}

/** A connection row was deleted. */
export interface CommunityConnectionRemovedEventDto {
  type: 'community_connection:removed';
  data: { id: string };
}

/** How changes are reaching this stream: one feed state per platform. */
export interface CommunityRealtimeStatusDto {
  /** Every platform, so a client can render a feed it has no connection for as well. */
  feeds: Record<CommunityPlatform, CommunityFeedState>;
}

/**
 * Sent when a client subscribes, and again whenever a feed changes state, so an
 * open page can say which platforms it is hearing from.
 */
export interface CommunityConnectionWatchEventDto {
  type: 'community_connection:watch';
  data: CommunityRealtimeStatusDto;
}

/**
 * Sent every few seconds while nothing else happens, so proxies with idle
 * timeouts keep the stream open and a client can tell a quiet stream from a
 * dead one.
 */
export interface CommunityConnectionHeartbeatEventDto {
  type: 'community_connection:heartbeat';
  data: { at: string };
}

/** Payloads of the `community/connections/events` SSE stream. */
export type CommunityConnectionEventDto =
  | CommunityConnectionUpdatedEventDto
  | CommunityConnectionRemovedEventDto
  | CommunityConnectionWatchEventDto
  | CommunityConnectionHeartbeatEventDto;

/** A Mattermost team the pasted token's bot account belongs to. */
export interface MattermostTeamDto {
  id: string;
  name: string;
  displayName: string;
}

/**
 * `POST mattermost/validate` request. The token travels only in this body and
 * is never stored by the endpoint; the response carries the teams to pick from.
 */
export interface MattermostValidateRequestDto {
  serverUrl: string;
  token: string;
}

export interface MattermostValidationDto {
  teams: MattermostTeamDto[];
}

/** `POST mattermost/connect` request: validate again, seal the token, save. */
export interface MattermostConnectRequestDto extends MattermostValidateRequestDto {
  teamId: string;
}

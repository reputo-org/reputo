import type { CommunityConnectionStatus, CommunityPlatform, CommunityResourceKind } from '../enums/community.js';

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
   * Safe category of the most recent failed operation, present while the
   * connection is not active. Never carries a platform response body.
   */
  statusReason?: string;
  /**
   * When the platform last confirmed this state. Health is checked on connect,
   * on demand, and per snapshot — never on a timer — so a status is only as
   * current as this timestamp.
   */
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** One selectable resource inside a connected community — a Discord channel, a GitHub repository. */
export interface CommunityResourceDto {
  id: string;
  name: string;
  /** Canonical resource kind, platform-neutral. */
  kind: CommunityResourceKind;
}

/** Result of an on-demand capability probe. */
export interface CommunityHealthDto {
  status: CommunityConnectionStatus;
  checkedAt: string;
  /** Human-readable reason when the probe did not succeed. */
  reason?: string;
}

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

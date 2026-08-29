import type { CommunityConnectionStatus, CommunityPlatform } from '../enums/community.js';

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

/** One selectable resource inside a connected community — a Discord channel. */
export interface CommunityResourceDto {
  id: string;
  name: string;
  /** Canonical resource kind, platform-neutral. */
  kind: 'text' | 'announcement' | 'forum';
}

/** Result of an on-demand capability probe. */
export interface CommunityHealthDto {
  status: CommunityConnectionStatus;
  checkedAt: string;
  /** Human-readable reason when the probe did not succeed. */
  reason?: string;
}

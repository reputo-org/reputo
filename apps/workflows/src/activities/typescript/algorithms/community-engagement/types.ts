/**
 * Shared scoring engine for the community engagement algorithms
 * (`discord_engagement`, `github_engagement`, `mattermost_engagement`).
 * Platform specifics arrive as configuration: the dataset prefix and the
 * activity enum. The engine itself only ever sees the frozen Parquet dataset.
 */

/** One configured activity row from the preset's `activities` input. */
export interface ActivityWeight {
  points: number;
  dailyCap: number;
}

export interface CommunityEngagementConfig {
  /** Dataset prefix segment: `snapshots/{id}/community_{platform}/`. */
  platform: string;
  /** Algorithm key — also the CSV score column and the output key prefix. */
  algorithmKey: string;
  /** Every scoreable activity, in the canonical order weights are applied in. */
  activityTypes: readonly string[];
  /**
   * Derived once-per-UTC-day activity, when the platform has one. Its daily
   * cap bounds the number of credited days in the window, not units per day.
   */
  activeDay?: {
    type: string;
    /** Activity types whose presence marks a day active. */
    sourceTypes: readonly string[];
  };
}

/** One cohort membership row read back from `cohort.parquet`. */
export interface CohortMemberRow {
  did: string;
  username: string | null;
  accountId: string | null;
  status: string;
}

export interface CoverageRow {
  resource: string;
  status: string;
  reason?: string;
}

/** Integer unit totals for one (did, activity), aggregated in SQL. */
export interface ActivityUnitTotals {
  units: number;
  cappedUnits: number;
}

export interface CommunityEngagementUserDetails {
  did: string;
  status: string;
  username: string | null;
  account_id: string | null;
  score: number;
  activities: Record<string, { units: number; capped_units: number; points: number }>;
}

export interface CommunityEngagementDetails {
  users: CommunityEngagementUserDetails[];
  metadata: {
    snapshot_id: string;
    platform: string;
    window: { start: string; end: string };
    cohort: {
      consented: number;
      matched: number;
      unmatched: number;
      active: number;
      inactive: number;
    };
    coverage: CoverageRow[];
    activities: Array<{ activity: string; points: number; daily_cap: number }>;
  };
}

const POINTS_PRECISION = 1e6;

/** Stable rounding for weighted points, so float artifacts never reach the CSV. */
export function roundPoints(value: number): number {
  return Math.round(value * POINTS_PRECISION) / POINTS_PRECISION;
}

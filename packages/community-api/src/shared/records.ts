import type { CommunityProbeResult, CommunityResource } from './types.js';

/**
 * The canonical dataset contract every platform adapter maps onto. The dataset
 * engine, freeze, and manifest code work only with these shapes; platform
 * specifics (endpoints, pagination, payload quirks) live behind
 * `CommunityAdapter` implementations.
 */

/** Activity types the chat platforms (Discord, Mattermost) emit. */
export const CommunityChatActivityType = {
  message: 'message',
  reply: 'reply',
  reactionReceived: 'reaction_received',
  replyReceived: 'reply_received',
  mentionReceived: 'mention_received',
} as const;

export type CommunityChatActivityType = (typeof CommunityChatActivityType)[keyof typeof CommunityChatActivityType];

/**
 * One content-free activity row — one row per (event, direction, participant).
 * Rows carry only ids, timestamps, and counts; never message text, titles, or
 * bodies. Records without a stable platform user id are never emitted.
 *
 * A row's identity is (type, actor, counterparty, resource, objectId); the
 * engine deduplicates on it, so re-crawling an overlap after a retry is safe.
 */
export interface CommunityActivityRecord {
  /** Platform-scoped activity type, e.g. `message` or `reaction_received`. */
  type: string;
  /** Stable platform user id the activity is credited to. */
  actor: string;
  /**
   * Stable platform user id on the other side of the activity, where the
   * platform exposes one — the replied-to author, the mentioner. Null when the
   * platform does not reveal it (Discord reaction counts carry no reactors).
   */
  counterparty: string | null;
  /** Selected resource the record rolls up to — thread rows carry their parent channel. */
  resource: string;
  /** Platform object the record derives from — a message id. */
  objectId: string;
  /** Defining timestamp, ISO 8601 UTC. Decides window membership and never changes. */
  occurredAt: string;
  /** Aggregated count as of fetch time (reaction totals); 1 for single events. */
  count: number;
  /** The actor is a bot or webhook. Bot rows stay in the dataset, flagged. */
  actorIsBot: boolean;
  /** The platform reported the underlying object as deleted (Mattermost `since` sync). */
  deleted: boolean;
}

/** Half-open fetch window `[start, end)`, ISO 8601 UTC. Fixed by the workflow at run start. */
export interface CommunityFetchWindow {
  start: string;
  end: string;
}

export const CommunityCoverageStatus = {
  complete: 'complete',
  partial: 'partial',
  failed: 'failed',
} as const;

export type CommunityCoverageStatus = (typeof CommunityCoverageStatus)[keyof typeof CommunityCoverageStatus];

/**
 * Fetch outcome for one selected resource. `partial` means some records were
 * read but a sub-part was truncated or unreadable; `failed` means nothing
 * could be read. The reason is built from safe error categories only.
 */
export interface CommunityResourceCoverage {
  resource: string;
  status: CommunityCoverageStatus;
  reason?: string;
}

/**
 * One page batch of canonical records plus the opaque resume cursor that
 * continues the crawl after everything yielded so far. Batches may be empty —
 * they still advance the cursor and prove liveness.
 */
export interface CommunityRecordBatch {
  records: CommunityActivityRecord[];
  cursor: string;
}

export interface IterateRecordsRequest {
  resourceId: string;
  window: CommunityFetchWindow;
  /** Cursor from a previous batch to resume from instead of restarting. */
  cursor?: string;
}

/**
 * The narrow interface a platform implements to join the community pipeline:
 * list resources, probe, iterate records. Adding a platform adds one adapter
 * (plus its registry entry); the engine, freeze, and scoring do not change.
 *
 * `iterateRecords` streams one selected resource as page batches and returns
 * its coverage. Permanent, resource-scoped failures (revoked permission, a
 * deleted channel) end as `failed`/`partial` coverage; transient or
 * connection-wide failures (auth, network, exhausted rate limit) throw so the
 * caller can retry the whole fetch from the last cursor.
 */
export interface CommunityAdapter {
  readonly platform: string;
  /** Selectable resources of a connected community, e.g. a guild's channels. */
  listResources(communityId: string): Promise<CommunityResource[]>;
  /** Verifies the granted permissions by listing resources and reading one page of history. */
  probe(communityId: string): Promise<CommunityProbeResult>;
  iterateRecords(request: IterateRecordsRequest): AsyncGenerator<CommunityRecordBatch, CommunityResourceCoverage>;
  /**
   * Resolves a platform username to its stable platform account id through a
   * per-username member lookup — exact match only, `null` when no member
   * matches. The cohort step depends on this staying a lookup, never a guess.
   */
  searchMemberId(communityId: string, username: string): Promise<string | null>;
}

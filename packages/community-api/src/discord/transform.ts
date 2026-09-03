import { CommunityContractError } from '../shared/errors.js';
import {
  type CommunityActivityRecord,
  CommunityChatActivityType,
  type CommunityFetchWindow,
  isWithinWindow,
  toUtcIso,
} from '../shared/records.js';
import {
  type CommunityProfile,
  type CommunityResource,
  CommunityResourceAccessIssue,
  type CommunityResourceKind,
} from '../shared/types.js';
import {
  DISCORD_AUTHORIZE_URL,
  DISCORD_BOT_PERMISSIONS,
  DISCORD_CDN_BASE_URL,
  DiscordChannelType,
  type DiscordInstalledGuild,
  DiscordMessageType,
  DiscordOverwriteType,
  type DiscordRawChannel,
  type DiscordRawGuild,
  type DiscordRawGuildMember,
  type DiscordRawMessage,
  type DiscordRawPermissionOverwrite,
  type DiscordRawRole,
  type DiscordRawThread,
  DiscordThreadType,
  type DiscordTokenResponse,
} from './types.js';

export interface BuildInstallUrlParams {
  clientId: string;
  callbackUrl: string;
  /** Signed, TTL-bounded value the caller mints and verifies on the callback. */
  state: string;
  /**
   * Guild to pre-select on the authorization screen. Set when reconnecting an
   * existing community so the admin cannot land on the wrong server; the guild
   * picker is locked to it.
   */
  guildId?: string;
}

const CHANNEL_KIND_BY_TYPE = new Map<number, CommunityResourceKind>([
  [DiscordChannelType.guildText, 'text'],
  [DiscordChannelType.guildAnnouncement, 'announcement'],
  [DiscordChannelType.guildForum, 'forum'],
]);

const DiscordPermission = {
  administrator: 1n << 3n,
  viewChannel: 1n << 10n,
  readMessageHistory: 1n << 16n,
} as const;

/**
 * The guild-level facts Discord's effective-permission algorithm starts from,
 * narrowed once per guild and reused for every channel of the listing.
 */
export interface DiscordPermissionContext {
  guildId: string;
  botUserId: string;
  botRoleIds: readonly string[];
  /** Base permission bitfield of every guild role, the @everyone role included under the guild id. */
  permissionsByRoleId: ReadonlyMap<string, bigint>;
}

/** The bot's read access to one channel, with the blocking issue when it has none. */
export type DiscordChannelAccess =
  | { readable: true }
  | { readable: false; accessIssue: typeof CommunityResourceAccessIssue.missingViewChannel }
  | { readable: false; accessIssue: typeof CommunityResourceAccessIssue.missingReadHistory };

function permissionBits(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new CommunityContractError(`Discord returned a malformed ${field} permission value.`);
  }
  return BigInt(value);
}

/** Narrows the bot's guild member and the guild's roles into the resolver's context. Fails closed on anything malformed. */
export function toDiscordPermissionContext(
  guildId: string,
  botUserId: string,
  member: DiscordRawGuildMember,
  roles: readonly DiscordRawRole[],
): DiscordPermissionContext {
  if (botUserId.length === 0) {
    throw new CommunityContractError('Discord returned no bot user id for the permission check.');
  }
  if (!Array.isArray(member?.roles) || !member.roles.every((roleId) => typeof roleId === 'string')) {
    throw new CommunityContractError('Discord returned malformed bot role ids for the permission check.');
  }
  if (!Array.isArray(roles)) {
    throw new CommunityContractError('Discord returned a malformed guild role listing.');
  }

  const permissionsByRoleId = new Map<string, bigint>();
  for (const role of roles) {
    if (typeof role?.id !== 'string' || role.id.length === 0) {
      throw new CommunityContractError('Discord returned a guild role without an id.');
    }
    permissionsByRoleId.set(role.id, permissionBits(role.permissions, 'role'));
  }
  if (!permissionsByRoleId.has(guildId)) {
    throw new CommunityContractError('Discord returned no @everyone role for the permission check.');
  }
  for (const roleId of member.roles) {
    if (!permissionsByRoleId.has(roleId)) {
      throw new CommunityContractError('Discord omitted one of the bot roles from the permission check.');
    }
  }

  return { guildId, botUserId, botRoleIds: member.roles, permissionsByRoleId };
}

interface DiscordOverwrite {
  id: string;
  type: number;
  allow: bigint;
  deny: bigint;
}

function parseOverwrites(raw: unknown): DiscordOverwrite[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CommunityContractError('Discord returned malformed channel permission overwrites.');
  }

  return raw.map((entry) => {
    const overwrite = entry as DiscordRawPermissionOverwrite | null;
    if (typeof overwrite?.id !== 'string' || typeof overwrite.type !== 'number') {
      throw new CommunityContractError('Discord returned a malformed channel permission overwrite.');
    }
    return {
      id: overwrite.id,
      type: overwrite.type,
      allow: permissionBits(overwrite.allow, 'allow'),
      deny: permissionBits(overwrite.deny, 'deny'),
    };
  });
}

/**
 * Discord's effective-permission algorithm for one channel: the @everyone role
 * and every role the bot holds, Administrator short-circuiting, then the
 * channel overwrites in Discord's order — @everyone, the bot's roles (denies
 * before allows), the bot member itself. Discord answers a history request
 * with `200 []` when View Channel is allowed but Read Message History is not,
 * so the HTTP status of a read alone is never proof of access.
 */
export function resolveDiscordChannelAccess(
  channel: DiscordRawChannel,
  context: DiscordPermissionContext,
): DiscordChannelAccess {
  let permissions = context.permissionsByRoleId.get(context.guildId) ?? 0n;
  for (const roleId of context.botRoleIds) {
    permissions |= context.permissionsByRoleId.get(roleId) ?? 0n;
  }
  if ((permissions & DiscordPermission.administrator) !== 0n) {
    return { readable: true };
  }

  const overwrites = parseOverwrites(channel?.permission_overwrites);
  const apply = (allow: bigint, deny: bigint) => {
    permissions = (permissions & ~deny) | allow;
  };

  const everyone = overwrites.find(
    (overwrite) => overwrite.type === DiscordOverwriteType.role && overwrite.id === context.guildId,
  );
  if (everyone) {
    apply(everyone.allow, everyone.deny);
  }

  const botRoles = new Set(context.botRoleIds);
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === DiscordOverwriteType.role && botRoles.has(overwrite.id)) {
      roleAllow |= overwrite.allow;
      roleDeny |= overwrite.deny;
    }
  }
  apply(roleAllow, roleDeny);

  const member = overwrites.find(
    (overwrite) => overwrite.type === DiscordOverwriteType.member && overwrite.id === context.botUserId,
  );
  if (member) {
    apply(member.allow, member.deny);
  }

  if ((permissions & DiscordPermission.viewChannel) === 0n) {
    return { readable: false, accessIssue: CommunityResourceAccessIssue.missingViewChannel };
  }
  if ((permissions & DiscordPermission.readMessageHistory) === 0n) {
    return { readable: false, accessIssue: CommunityResourceAccessIssue.missingReadHistory };
  }
  return { readable: true };
}

/**
 * Bot-install authorization URL. `scope=bot` with exactly the read permissions
 * the pipeline needs, and `response_type=code` so the callback can exchange the
 * code and learn which guild was installed.
 */
export function buildInstallUrl({ clientId, callbackUrl, state, guildId }: BuildInstallUrlParams): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'bot');
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);

  if (guildId) {
    url.searchParams.set('guild_id', guildId);
    url.searchParams.set('disable_guild_select', 'true');
  }

  return url.toString();
}

/** The guild a bot-scoped token exchange installed into. */
export function extractInstalledGuild(response: DiscordTokenResponse): DiscordInstalledGuild {
  const id = response?.guild?.id;
  const name = response?.guild?.name;

  if (typeof id !== 'string' || id.length === 0) {
    throw new CommunityContractError('Discord token response carried no guild id; the bot scope was not granted.');
  }

  return { id, name: typeof name === 'string' && name.length > 0 ? name : id };
}

/**
 * Channels the pipeline could read, in the order Discord shows them, each
 * carrying the bot's effective read access. The guild listing returns every
 * channel whether or not the bot can see it, so the verdict is what keeps a
 * private channel from being offered as readable.
 */
export function toCommunityResources(
  channels: readonly DiscordRawChannel[],
  context: DiscordPermissionContext,
): CommunityResource[] {
  if (!Array.isArray(channels)) {
    throw new CommunityContractError('Discord channel listing was not an array.');
  }

  return channels
    .filter(
      (channel): channel is DiscordRawChannel & { id: string; type: number } =>
        typeof channel?.id === 'string' && typeof channel.type === 'number' && CHANNEL_KIND_BY_TYPE.has(channel.type),
    )
    .sort((a, b) => {
      const positionA = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const positionB = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
      return positionA === positionB ? a.id.localeCompare(b.id) : positionA - positionB;
    })
    .map((channel) => {
      const resource = {
        id: channel.id,
        name: typeof channel.name === 'string' && channel.name.length > 0 ? channel.name : channel.id,
        kind: CHANNEL_KIND_BY_TYPE.get(channel.type) as CommunityResourceKind,
      };
      const access = resolveDiscordChannelAccess(channel, context);
      return access.readable
        ? { ...resource, readable: true }
        : { ...resource, readable: false, accessIssue: access.accessIssue };
    });
}

/** Display facts from the guild object. A missing icon or count stays undefined. */
export function toDiscordGuildProfile(guildId: string, raw: DiscordRawGuild): CommunityProfile {
  const icon = raw?.icon;
  const memberCount = raw?.approximate_member_count;

  return {
    avatarUrl:
      typeof icon === 'string' && icon.length > 0
        ? `${DISCORD_CDN_BASE_URL}/icons/${encodeURIComponent(guildId)}/${encodeURIComponent(icon)}.png?size=128`
        : undefined,
    memberCount: typeof memberCount === 'number' && Number.isFinite(memberCount) ? memberCount : undefined,
  };
}

/**
 * Whether a sampled page carries the fields the fetch depends on. The bot runs
 * without privileged intents, so the probe proves these arrive over REST before
 * a snapshot ever relies on them. An empty page has no malformed rows; read
 * access itself is resolved from the permission model, not from the page.
 */
export function hasRequiredMessageFields(messages: readonly DiscordRawMessage[]): boolean {
  return messages.every(
    (message) =>
      typeof message?.id === 'string' &&
      typeof message.timestamp === 'string' &&
      typeof message.author?.id === 'string',
  );
}

const DISCORD_EPOCH_MS = 1_420_070_400_000;

/**
 * The smallest snowflake a message created at `iso` can have. Passing it as a
 * `before` cursor starts pagination exactly at the window end (exclusive), so
 * the walk never touches messages created at or after the boundary.
 */
export function snowflakeForTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new CommunityContractError('Fetch window boundary is not a valid ISO timestamp.');
  }
  return String(BigInt(Math.max(0, ms - DISCORD_EPOCH_MS)) << 22n);
}

function sumReactionCounts(reactions: unknown): number {
  if (!Array.isArray(reactions)) {
    return 0;
  }
  let total = 0;
  for (const reaction of reactions) {
    const count = (reaction as { count?: unknown })?.count;
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      total += count;
    }
  }
  return total;
}

function mentionedUsers(mentions: unknown): Array<{ id: string; bot: boolean }> {
  if (!Array.isArray(mentions)) {
    return [];
  }
  const byId = new Map<string, boolean>();
  for (const mention of mentions) {
    const id = (mention as { id?: unknown })?.id;
    if (typeof id === 'string' && id.length > 0 && !byId.has(id)) {
      byId.set(id, (mention as { bot?: unknown }).bot === true);
    }
  }
  return [...byId.entries()].map(([id, bot]) => ({ id, bot }));
}

/**
 * Maps one raw Discord message to canonical, content-free activity rows,
 * keeping only rows whose defining timestamp falls inside the window.
 *
 * - `message`/`reply` and the derived `reaction_received` and
 *   `mention_received` rows use the crawled message's creation time.
 * - `reply_received` credits the replied-to author at the receiving message's
 *   creation time (the doc's rule for received activities), so a reply to a
 *   message outside the window yields no received row.
 * - Only human-content message types (default, reply) produce rows; records
 *   without a stable author id are dropped; self-mentions and self-reactions
 *   are not filtered — daily caps bound them at scoring time.
 */
export function toActivityRecords(
  raw: DiscordRawMessage,
  resourceId: string,
  window: CommunityFetchWindow,
): CommunityActivityRecord[] {
  const objectId = raw?.id;
  const authorId = raw?.author?.id;
  const occurredAt = toUtcIso(raw?.timestamp);
  if (typeof objectId !== 'string' || typeof authorId !== 'string' || occurredAt === undefined) {
    return [];
  }

  const isReply = raw.type === DiscordMessageType.reply;
  if (raw.type !== DiscordMessageType.default && !isReply) {
    return [];
  }

  const actorIsBot = raw.author?.bot === true;
  const parent = raw.referenced_message ?? undefined;
  const parentAuthorId = typeof parent?.author?.id === 'string' ? parent.author.id : undefined;
  const records: CommunityActivityRecord[] = [];

  const push = (record: CommunityActivityRecord) => {
    if (isWithinWindow(record.occurredAt, window)) {
      records.push(record);
    }
  };

  push({
    type: isReply ? CommunityChatActivityType.reply : CommunityChatActivityType.message,
    actor: authorId,
    counterparty: isReply ? (parentAuthorId ?? null) : null,
    resource: resourceId,
    objectId,
    occurredAt,
    count: 1,
    actorIsBot,
    deleted: false,
  });

  const reactionCount = sumReactionCounts(raw.reactions);
  if (reactionCount > 0) {
    push({
      type: CommunityChatActivityType.reactionReceived,
      actor: authorId,
      counterparty: null,
      resource: resourceId,
      objectId,
      occurredAt,
      count: reactionCount,
      actorIsBot,
      deleted: false,
    });
  }

  if (isReply && parentAuthorId !== undefined) {
    const parentOccurredAt = toUtcIso(parent?.timestamp);
    if (parentOccurredAt !== undefined) {
      push({
        type: CommunityChatActivityType.replyReceived,
        actor: parentAuthorId,
        counterparty: authorId,
        resource: resourceId,
        objectId,
        occurredAt: parentOccurredAt,
        count: 1,
        actorIsBot: parent?.author?.bot === true,
        deleted: false,
      });
    }
  }

  for (const mentioned of mentionedUsers(raw.mentions)) {
    push({
      type: CommunityChatActivityType.mentionReceived,
      actor: mentioned.id,
      counterparty: authorId,
      resource: resourceId,
      objectId,
      occurredAt,
      count: 1,
      actorIsBot: mentioned.bot,
      deleted: false,
    });
  }

  return records;
}

/**
 * The account id of the member whose username equals `username` exactly.
 * Discord's member search matches by prefix on usernames and nicknames, so the
 * result is narrowed to an exact username match — never a guess.
 */
export function findExactMemberId(members: readonly DiscordRawGuildMember[], username: string): string | null {
  if (!Array.isArray(members)) {
    throw new CommunityContractError('Discord member search result was not an array.');
  }

  for (const member of members) {
    const user = member?.user;
    if (typeof user?.id === 'string' && user.id.length > 0 && user.username === username) {
      return user.id;
    }
  }

  return null;
}

/** A thread the crawl walks, with its archive time when the listing carries one. */
export interface DiscordCrawlableThread {
  id: string;
  archiveTimestamp?: string;
}

/**
 * Narrows a raw thread listing to the crawlable threads of one parent channel:
 * public and announcement threads only — private threads are out of scope.
 */
export function toCrawlableThreads(threads: unknown, parentId: string): DiscordCrawlableThread[] {
  if (!Array.isArray(threads)) {
    return [];
  }

  const crawlable: DiscordCrawlableThread[] = [];
  for (const thread of threads as DiscordRawThread[]) {
    const isPublicType =
      thread?.type === DiscordThreadType.publicThread || thread?.type === DiscordThreadType.announcementThread;
    if (!isPublicType || typeof thread.id !== 'string' || thread.parent_id !== parentId) {
      continue;
    }

    const archiveTimestamp = thread.thread_metadata?.archive_timestamp;
    crawlable.push({
      id: thread.id,
      archiveTimestamp: typeof archiveTimestamp === 'string' ? archiveTimestamp : undefined,
    });
  }

  return crawlable.sort((a, b) => a.id.localeCompare(b.id));
}

/** Parsed channel fields the crawl needs; undefined when the payload lacks them. */
export interface DiscordChannelMeta {
  id: string;
  guildId: string;
  kind: CommunityResourceKind;
}

export function toChannelMeta(channel: DiscordRawChannel): DiscordChannelMeta | undefined {
  if (
    typeof channel?.id !== 'string' ||
    typeof channel.guild_id !== 'string' ||
    typeof channel.type !== 'number' ||
    !CHANNEL_KIND_BY_TYPE.has(channel.type)
  ) {
    return undefined;
  }

  return {
    id: channel.id,
    guildId: channel.guild_id,
    kind: CHANNEL_KIND_BY_TYPE.get(channel.type) as CommunityResourceKind,
  };
}

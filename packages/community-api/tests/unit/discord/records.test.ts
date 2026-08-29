import { describe, expect, it } from 'vitest';
import {
  snowflakeForTimestamp,
  toActivityRecords,
  toChannelMeta,
  toCrawlableThreads,
} from '../../../src/discord/transform.js';
import type { DiscordRawMessage } from '../../../src/discord/types.js';
import { CommunityContractError } from '../../../src/shared/errors.js';

const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };
const RESOURCE = 'chan-1';

const message = (overrides: Partial<DiscordRawMessage> = {}): DiscordRawMessage => ({
  id: 'm1',
  type: 0,
  timestamp: '2026-07-01T12:00:00.000Z',
  author: { id: 'alice' },
  ...overrides,
});

describe('toActivityRecords', () => {
  it('maps a plain message to one content-free row', () => {
    expect(toActivityRecords(message(), RESOURCE, WINDOW)).toEqual([
      {
        type: 'message',
        actor: 'alice',
        counterparty: null,
        resource: RESOURCE,
        objectId: 'm1',
        occurredAt: '2026-07-01T12:00:00.000Z',
        count: 1,
        actorIsBot: false,
        deleted: false,
      },
    ]);
  });

  it('normalizes offset timestamps to UTC', () => {
    const records = toActivityRecords(message({ timestamp: '2026-07-01T14:00:00.000+02:00' }), RESOURCE, WINDOW);
    expect(records[0].occurredAt).toBe('2026-07-01T12:00:00.000Z');
  });

  it('maps a reply to a reply row plus a received row for the replied-to author', () => {
    const records = toActivityRecords(
      message({
        id: 'r1',
        type: 19,
        referenced_message: { id: 'm0', timestamp: '2026-06-20T08:00:00.000Z', author: { id: 'bob' } },
      }),
      RESOURCE,
      WINDOW,
    );

    expect(records).toEqual([
      expect.objectContaining({ type: 'reply', actor: 'alice', counterparty: 'bob', objectId: 'r1' }),
      expect.objectContaining({
        type: 'reply_received',
        actor: 'bob',
        counterparty: 'alice',
        objectId: 'r1',
        // Received activities anchor to the receiving message's creation time.
        occurredAt: '2026-06-20T08:00:00.000Z',
      }),
    ]);
  });

  it('keeps the reply but drops the received row when the parent is outside the window', () => {
    const records = toActivityRecords(
      message({
        id: 'r1',
        type: 19,
        referenced_message: { id: 'm0', timestamp: '2025-01-01T00:00:00.000Z', author: { id: 'bob' } },
      }),
      RESOURCE,
      WINDOW,
    );

    expect(records.map((record) => record.type)).toEqual(['reply']);
  });

  it('maps a reply to a deleted parent with a null counterparty and no received row', () => {
    const records = toActivityRecords(message({ id: 'r1', type: 19, referenced_message: null }), RESOURCE, WINDOW);
    expect(records).toEqual([expect.objectContaining({ type: 'reply', counterparty: null })]);
  });

  it('sums reaction counts into one received row without a counterparty', () => {
    const records = toActivityRecords(
      message({ reactions: [{ count: 3 }, { count: 2 }, { count: 'bad' }, { count: -1 }] }),
      RESOURCE,
      WINDOW,
    );

    expect(records).toEqual([
      expect.objectContaining({ type: 'message' }),
      expect.objectContaining({ type: 'reaction_received', actor: 'alice', counterparty: null, count: 5 }),
    ]);
  });

  it('emits one mention row per unique mentioned user, self-mentions included', () => {
    const records = toActivityRecords(
      message({
        mentions: [{ id: 'bob' }, { id: 'bob' }, { id: 'bot-1', bot: true }, { id: 'alice' }, { name: 'no-id' }],
      }),
      RESOURCE,
      WINDOW,
    );

    expect(records.filter((record) => record.type === 'mention_received')).toEqual([
      expect.objectContaining({ actor: 'bob', counterparty: 'alice', actorIsBot: false }),
      expect.objectContaining({ actor: 'bot-1', counterparty: 'alice', actorIsBot: true }),
      expect.objectContaining({ actor: 'alice', counterparty: 'alice' }),
    ]);
  });

  it('flags bot authors on their rows instead of dropping them', () => {
    const records = toActivityRecords(
      message({ author: { id: 'hook', bot: true }, reactions: [{ count: 1 }] }),
      RESOURCE,
      WINDOW,
    );
    expect(records.every((record) => record.actorIsBot)).toBe(true);
  });

  it('skips system message types entirely, their reactions included', () => {
    for (const type of [4, 7, 21]) {
      expect(toActivityRecords(message({ type, reactions: [{ count: 4 }] }), RESOURCE, WINDOW)).toEqual([]);
    }
  });

  it('drops records without a stable id, author id, or timestamp', () => {
    expect(toActivityRecords(message({ author: {} }), RESOURCE, WINDOW)).toEqual([]);
    expect(toActivityRecords(message({ id: undefined }), RESOURCE, WINDOW)).toEqual([]);
    expect(toActivityRecords(message({ timestamp: 'not-a-time' }), RESOURCE, WINDOW)).toEqual([]);
  });

  it('applies the half-open window: start inclusive, end exclusive', () => {
    expect(toActivityRecords(message({ timestamp: WINDOW.start }), RESOURCE, WINDOW)).toHaveLength(1);
    expect(toActivityRecords(message({ timestamp: WINDOW.end }), RESOURCE, WINDOW)).toEqual([]);
    expect(toActivityRecords(message({ timestamp: '2026-05-31T23:59:59.999Z' }), RESOURCE, WINDOW)).toEqual([]);
  });
});

describe('snowflakeForTimestamp', () => {
  it('encodes milliseconds since the Discord epoch into the id timestamp bits', () => {
    expect(snowflakeForTimestamp('2015-01-01T00:00:00.000Z')).toBe('0');
    expect(snowflakeForTimestamp('2015-01-01T00:00:00.001Z')).toBe(String(1n << 22n));
  });

  it('rejects an unparseable boundary', () => {
    expect(() => snowflakeForTimestamp('whenever')).toThrow(CommunityContractError);
  });
});

describe('toCrawlableThreads', () => {
  it('keeps public and announcement threads of the parent channel, sorted by id', () => {
    const threads = toCrawlableThreads(
      [
        { id: 'b', type: 11, parent_id: RESOURCE, thread_metadata: { archive_timestamp: '2026-07-02T00:00:00Z' } },
        { id: 'a', type: 10, parent_id: RESOURCE },
        { id: 'c', type: 11, parent_id: 'other-channel' },
        { id: 'd', type: 12, parent_id: RESOURCE },
        { id: 42, type: 11, parent_id: RESOURCE },
      ],
      RESOURCE,
    );

    expect(threads).toEqual([
      { id: 'a', archiveTimestamp: undefined },
      { id: 'b', archiveTimestamp: '2026-07-02T00:00:00Z' },
    ]);
  });

  it('treats a non-array listing as empty', () => {
    expect(toCrawlableThreads({ message: 'Missing Access' }, RESOURCE)).toEqual([]);
  });
});

describe('toChannelMeta', () => {
  it('parses the fields the crawl needs', () => {
    expect(toChannelMeta({ id: 'c1', type: 15, guild_id: 'g1' })).toEqual({ id: 'c1', guildId: 'g1', kind: 'forum' });
  });

  it('returns undefined for unsupported types or missing guild scope', () => {
    expect(toChannelMeta({ id: 'c1', type: 2, guild_id: 'g1' })).toBeUndefined();
    expect(toChannelMeta({ id: 'c1', type: 0 })).toBeUndefined();
  });
});

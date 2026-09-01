import { describe, expect, it } from 'vitest';
import {
  type MattermostPostPage,
  toAccountIdsByUsername,
  toMattermostActivityRecords,
  toMattermostPostPage,
  toMattermostUsers,
  toReactionCounts,
  toScoreablePost,
} from '../../../src/mattermost/transform.js';
import type { MattermostRawPost } from '../../../src/mattermost/types.js';
import { CommunityContractError } from '../../../src/shared/errors.js';

const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };

const at = (iso: string): number => Date.parse(iso);

const post = (overrides: Partial<MattermostRawPost> = {}): MattermostRawPost => ({
  id: 'p1',
  user_id: 'u1',
  create_at: at('2026-07-01T10:00:00.000Z'),
  delete_at: 0,
  root_id: '',
  type: '',
  message: 'hello',
  ...overrides,
});

const pageOf = (...posts: MattermostRawPost[]): MattermostPostPage =>
  toMattermostPostPage({
    order: posts.map((entry) => entry.id),
    posts: Object.fromEntries(posts.map((entry) => [String(entry.id), entry])),
  });

const records = (raw: MattermostRawPost, page = pageOf(raw), isBot: (id: string) => boolean = () => false) => {
  const narrowed = toScoreablePost(raw);
  expect(narrowed).toBeDefined();
  return toMattermostActivityRecords(narrowed as NonNullable<typeof narrowed>, raw, page, 'chan-1', WINDOW, isBot);
};

describe('toMattermostPostPage', () => {
  it('returns the ordered posts plus the map thread roots resolve from', () => {
    const root = post({ id: 'root', create_at: at('2026-06-01T09:00:00.000Z') });
    const reply = post({ id: 'reply', root_id: 'root' });
    // `order` lists only the requested posts; `posts` also carries their roots.
    const page = toMattermostPostPage({ order: ['reply'], posts: { reply, root } });

    expect(page.posts.map((entry) => entry.id)).toEqual(['reply']);
    expect(page.byId.get('root')).toBe(root);
  });

  it('skips ordered ids the posts map does not carry, and rejects a malformed payload', () => {
    expect(toMattermostPostPage({ order: ['ghost'], posts: {} }).posts).toEqual([]);
    expect(() => toMattermostPostPage({ order: 'nope', posts: {} })).toThrow(CommunityContractError);
    expect(() => toMattermostPostPage({ order: [], posts: null })).toThrow(CommunityContractError);
  });
});

describe('toScoreablePost', () => {
  it('narrows a human post and converts its Unix-millisecond timestamp to UTC', () => {
    expect(toScoreablePost(post())).toEqual({
      id: 'p1',
      userId: 'u1',
      occurredAt: '2026-07-01T10:00:00.000Z',
      rootId: null,
    });
    expect(toScoreablePost(post({ root_id: 'root' }))?.rootId).toBe('root');
  });

  it('drops system posts, deleted posts, and posts without a stable author or timestamp', () => {
    expect(toScoreablePost(post({ type: 'system_join_channel' }))).toBeUndefined();
    expect(toScoreablePost(post({ delete_at: at('2026-07-02T10:00:00.000Z') }))).toBeUndefined();
    expect(toScoreablePost(post({ user_id: '' }))).toBeUndefined();
    expect(toScoreablePost(post({ id: undefined }))).toBeUndefined();
    expect(toScoreablePost(post({ create_at: 0 }))).toBeUndefined();
    expect(toScoreablePost(post({ create_at: '2026-07-01T10:00:00Z' }))).toBeUndefined();
    expect(toScoreablePost(undefined)).toBeUndefined();
  });
});

describe('toReactionCounts', () => {
  it('counts reactions per reactor and ignores malformed entries', () => {
    const counts = toReactionCounts(
      post({
        metadata: {
          reactions: [
            { user_id: 'u2', post_id: 'p1' },
            { user_id: 'u2', post_id: 'p1' },
            { user_id: 'u3', post_id: 'p1' },
            { user_id: '' },
            {},
          ],
        },
      }),
    );

    expect([...counts]).toEqual([
      ['u2', 2],
      ['u3', 1],
    ]);
  });

  it('is empty when the post carries no reaction metadata', () => {
    expect(toReactionCounts(post()).size).toBe(0);
    expect(toReactionCounts(post({ metadata: { reactions: 'nope' } })).size).toBe(0);
  });
});

describe('toMattermostActivityRecords', () => {
  it('maps a root post to one message row', () => {
    expect(records(post())).toEqual([
      {
        type: 'message',
        actor: 'u1',
        counterparty: null,
        resource: 'chan-1',
        objectId: 'p1',
        occurredAt: '2026-07-01T10:00:00.000Z',
        count: 1,
        actorIsBot: false,
        deleted: false,
      },
    ]);
  });

  it('maps a thread reply to a reply row and credits the root author at the root time', () => {
    const root = post({ id: 'root', user_id: 'u9', create_at: at('2026-06-15T08:00:00.000Z') });
    const reply = post({ id: 'reply', root_id: 'root' });

    expect(records(reply, pageOf(reply, root))).toEqual([
      expect.objectContaining({
        type: 'reply',
        actor: 'u1',
        counterparty: 'u9',
        occurredAt: '2026-07-01T10:00:00.000Z',
      }),
      // The received row is defined by the receiving post's creation time.
      expect.objectContaining({
        type: 'reply_received',
        actor: 'u9',
        counterparty: 'u1',
        objectId: 'reply',
        occurredAt: '2026-06-15T08:00:00.000Z',
      }),
    ]);
  });

  it('drops the received row when the root fell outside the window, keeping the reply itself', () => {
    const root = post({ id: 'root', user_id: 'u9', create_at: at('2025-01-01T08:00:00.000Z') });
    const reply = post({ id: 'reply', root_id: 'root' });

    expect(records(reply, pageOf(reply, root)).map((row) => row.type)).toEqual(['reply']);
  });

  it('still emits the reply row when the root is absent or unscoreable', () => {
    const deletedRoot = post({ id: 'root', user_id: 'u9', delete_at: at('2026-07-02T00:00:00.000Z') });
    const reply = post({ id: 'reply', root_id: 'root' });

    expect(records(reply, pageOf(reply, deletedRoot))).toEqual([
      expect.objectContaining({ type: 'reply', counterparty: null }),
    ]);
    expect(records(reply, pageOf(reply))).toEqual([expect.objectContaining({ type: 'reply', counterparty: null })]);
  });

  it('records the reactor as the counterparty, one row per reactor, at the post time', () => {
    const raw = post({
      metadata: {
        reactions: [{ user_id: 'u2' }, { user_id: 'u2' }, { user_id: 'u3' }, { user_id: 'u1' }],
      },
    });

    expect(records(raw)).toEqual([
      expect.objectContaining({ type: 'message' }),
      expect.objectContaining({ type: 'reaction_received', actor: 'u1', counterparty: 'u2', count: 2 }),
      expect.objectContaining({ type: 'reaction_received', actor: 'u1', counterparty: 'u3', count: 1 }),
      // A self-reaction is kept; daily caps bound it at scoring time.
      expect.objectContaining({ type: 'reaction_received', actor: 'u1', counterparty: 'u1', count: 1 }),
    ]);
  });

  it('flags bot rows on both sides of a reply and never reads the message text', () => {
    const root = post({ id: 'root', user_id: 'bot-1', create_at: at('2026-06-15T08:00:00.000Z') });
    const reply = post({ id: 'reply', root_id: 'root', user_id: 'bot-2', message: 'ping @someone' });

    const rows = records(reply, pageOf(reply, root), (id) => id.startsWith('bot-'));
    expect(rows.map((row) => [row.type, row.actor, row.actorIsBot])).toEqual([
      ['reply', 'bot-2', true],
      ['reply_received', 'bot-1', true],
    ]);
    // No mention row exists: Mattermost resolves no mention list and the
    // crawl never parses message text.
    expect(rows.some((row) => row.type === 'mention_received')).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('ping');
  });

  it('drops every row of a post outside the window', () => {
    const raw = post({ create_at: at('2026-08-01T00:00:00.000Z'), metadata: { reactions: [{ user_id: 'u2' }] } });

    expect(records(raw)).toEqual([]);
  });
});

describe('bulk account lookups', () => {
  it('rejects a non-array answer', () => {
    expect(() => toMattermostUsers({ id: 'u1' })).toThrow(CommunityContractError);
    expect(toMattermostUsers([{ id: 'u1' }])).toEqual([{ id: 'u1' }]);
  });

  it('keys account ids by the requested username and leaves the unanswered ones unmatched', () => {
    const resolved = toAccountIdsByUsername(
      [
        { id: 'u1', username: 'alice' },
        { id: '', username: 'broken' },
        { id: 'u9', username: 'stranger' },
      ],
      ['alice', 'ghost', 'broken'],
    );

    // `stranger` was never requested, so it cannot become a near match.
    expect([...resolved]).toEqual([
      ['alice', 'u1'],
      ['ghost', null],
      ['broken', null],
    ]);
  });
});

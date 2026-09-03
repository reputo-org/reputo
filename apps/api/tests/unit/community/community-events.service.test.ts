import { BehaviorSubject, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityService } from '../../../src/community/community.service';
import { CommunityEventsService } from '../../../src/community/community-events.service';
import type { CommunityConnectionEventDto } from '../../../src/community/dto';
import type { CommunityRealtimeService } from '../../../src/community/realtime';
import type { CommunityConnectionListenerService } from '../../../src/persistence';

const FEED_STATUS = {
  feeds: { discord: 'live', github: 'live', mattermost: 'live' },
  fallbackIntervalMs: 30_000,
} as const;

const CONNECTION = {
  id: '01940000-0000-7000-8000-000000000001',
  platform: 'discord',
  externalId: 'guild-1',
  name: 'SNET',
  status: 'broken',
  statusReason: 'kicked',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('CommunityEventsService', () => {
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };
  let notifications$: Subject<string>;
  let feedStatus: BehaviorSubject<typeof FEED_STATUS>;
  let findById: ReturnType<typeof vi.fn>;
  let service: CommunityEventsService;

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    notifications$ = new Subject<string>();
    feedStatus = new BehaviorSubject(FEED_STATUS);
    findById = vi.fn().mockResolvedValue(CONNECTION);
    service = new CommunityEventsService(
      logger as never,
      { notifications$: notifications$.asObservable() } as unknown as CommunityConnectionListenerService,
      { findById } as unknown as CommunityService,
      {
        status: feedStatus.value,
        status$: feedStatus.asObservable(),
      } as unknown as CommunityRealtimeService,
    );
    service.onModuleInit();
  });

  it('announces the feed status first, then relays a changed row as an update', async () => {
    const events: CommunityConnectionEventDto[] = [];
    service.subscribe().subscribe((event) => events.push(event));

    notifications$.next(JSON.stringify({ op: 'UPDATE', id: CONNECTION.id }));
    await flush();

    expect(findById).toHaveBeenCalledWith(CONNECTION.id);
    expect(events).toEqual([
      { type: 'community_connection:watch', data: FEED_STATUS },
      { type: 'community_connection:updated', data: CONNECTION },
    ]);
  });

  it('relays a deleted row by id without reading it', async () => {
    const events: CommunityConnectionEventDto[] = [];
    service.subscribe().subscribe((event) => events.push(event));

    notifications$.next(JSON.stringify({ op: 'DELETE', id: CONNECTION.id }));
    await flush();

    expect(findById).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: 'community_connection:removed', data: { id: CONNECTION.id } });
  });

  it('drops a notification for a row that vanished before it could be read', async () => {
    findById.mockResolvedValue(null);
    const events: CommunityConnectionEventDto[] = [];
    service.subscribe().subscribe((event) => events.push(event));

    notifications$.next(JSON.stringify({ op: 'UPDATE', id: CONNECTION.id }));
    await flush();

    expect(events).toHaveLength(1);
  });

  it('ignores malformed payloads and survives a failing read', async () => {
    findById.mockRejectedValueOnce(new Error('database unreachable'));
    const events: CommunityConnectionEventDto[] = [];
    service.subscribe().subscribe((event) => events.push(event));

    notifications$.next('not json');
    notifications$.next(JSON.stringify({ op: 'UPDATE' }));
    notifications$.next(JSON.stringify({ op: 'UPDATE', id: CONNECTION.id }));
    await flush();

    expect(events).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('heartbeats every 15 s so proxies keep an idle stream open', () => {
    vi.useFakeTimers();
    try {
      const events: CommunityConnectionEventDto[] = [];
      const subscription = service.subscribe().subscribe((event) => events.push(event));

      vi.advanceTimersByTime(15_000);
      expect(events.at(-1)).toMatchObject({ type: 'community_connection:heartbeat', data: { at: expect.any(String) } });

      subscription.unsubscribe();
      vi.advanceTimersByTime(30_000);
      expect(events.filter((event) => event.type === 'community_connection:heartbeat')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts subscribed clients so the sweep knows when someone is watching', () => {
    const counts: number[] = [];
    service.watcherCount$.subscribe((count) => counts.push(count));

    const first = service.subscribe().subscribe();
    const second = service.subscribe().subscribe();
    first.unsubscribe();
    second.unsubscribe();

    expect(counts).toEqual([0, 1, 2, 1, 0]);
    expect(service.watcherCount).toBe(0);
  });

  it('completes every client stream on shutdown', () => {
    const completed = vi.fn();
    service.subscribe().subscribe({ complete: completed });

    service.onModuleDestroy();

    expect(completed).toHaveBeenCalledOnce();
    expect(service.watcherCount).toBe(0);
  });
});

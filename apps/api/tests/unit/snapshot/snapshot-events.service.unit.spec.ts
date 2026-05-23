import { Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotListenerService } from '../../../src/persistence';
import type { SnapshotRepository, SnapshotRow } from '../../../src/snapshot/snapshot.repository';
import { SnapshotEventsService } from '../../../src/snapshot/snapshot-events.service';

function makeRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  const startedAt = overrides.startedAt ?? new Date('2026-03-06T11:59:00.000Z');
  const completedAt = overrides.completedAt ?? new Date('2026-03-06T12:00:00.000Z');
  return {
    _id: 'snapshot-1',
    status: 'running',
    algorithmPreset: 'preset-1',
    algorithmPresetFrozen: { key: 'algo', version: '1.0.0', inputs: [] },
    outputs: { csv: 'uploads/result.csv' },
    startedAt,
    completedAt,
    createdAt: new Date('2026-03-06T11:50:00.000Z'),
    updatedAt: new Date('2026-03-06T12:00:00.000Z'),
    ...overrides,
  };
}

function createService() {
  const notifications$ = new Subject<string>();
  const listener = { notifications$: notifications$.asObservable() } as unknown as SnapshotListenerService;
  const findById = vi.fn<(id: string) => Promise<SnapshotRow | null>>();
  const repository = { findById } as unknown as SnapshotRepository;
  const service = new SnapshotEventsService(listener, repository);
  return { service, notifications$, findById };
}

describe('SnapshotEventsService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the snapshot on NOTIFY and broadcasts an event to filtered subscribers', async () => {
    const { service, notifications$, findById } = createService();
    findById.mockResolvedValueOnce(makeRow({ _id: 'snapshot-1', algorithmPreset: 'preset-1' }));
    findById.mockResolvedValueOnce(makeRow({ _id: 'snapshot-2', algorithmPreset: 'preset-2' }));

    service.onModuleInit();

    const events: Array<Record<string, unknown>> = [];
    const subscription = service
      .subscribe({ algorithmPreset: 'preset-1' })
      .subscribe((event) => events.push(event as unknown as Record<string, unknown>));

    notifications$.next('snapshot-1');
    notifications$.next('snapshot-2');

    // Wait two microtask drains so the async repository fetch chain resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(findById).toHaveBeenNthCalledWith(1, 'snapshot-1');
    expect(findById).toHaveBeenNthCalledWith(2, 'snapshot-2');
    expect(events).toEqual([
      {
        type: 'snapshot:updated',
        data: {
          _id: 'snapshot-1',
          status: 'running',
          algorithmPreset: 'preset-1',
          outputs: { csv: 'uploads/result.csv' },
          startedAt: '2026-03-06T11:59:00.000Z',
          completedAt: '2026-03-06T12:00:00.000Z',
          updatedAt: '2026-03-06T12:00:00.000Z',
        },
      },
    ]);

    subscription.unsubscribe();
    expect((service as unknown as { clients: Map<string, unknown> }).clients.size).toBe(0);

    service.onModuleDestroy();
  });

  it('broadcasts to all subscribers when no filter is provided', async () => {
    const { service, notifications$, findById } = createService();
    findById.mockResolvedValue(makeRow({ _id: 'snapshot-3', algorithmPreset: 'preset-9' }));

    service.onModuleInit();

    const events: Array<Record<string, unknown>> = [];
    service.subscribe().subscribe((event) => events.push(event as unknown as Record<string, unknown>));

    notifications$.next('snapshot-3');
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect((events[0] as { data: { _id: string } }).data._id).toBe('snapshot-3');

    service.onModuleDestroy();
  });

  it('skips broadcast when the snapshot row no longer exists', async () => {
    const { service, notifications$, findById } = createService();
    findById.mockResolvedValueOnce(null);

    service.onModuleInit();

    const events: unknown[] = [];
    service.subscribe().subscribe((event) => events.push(event));

    notifications$.next('snapshot-missing');
    await Promise.resolve();
    await Promise.resolve();

    expect(findById).toHaveBeenCalledOnce();
    expect(events).toHaveLength(0);

    service.onModuleDestroy();
  });

  it('does not propagate repository errors to subscribers', async () => {
    const { service, notifications$, findById } = createService();
    findById.mockRejectedValueOnce(new Error('db down'));

    service.onModuleInit();

    const events: unknown[] = [];
    const errors: unknown[] = [];
    service.subscribe().subscribe({
      next: (event) => events.push(event),
      error: (err) => errors.push(err),
    });

    notifications$.next('snapshot-x');
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(0);

    service.onModuleDestroy();
  });

  it('completes per-client subjects on module destroy', async () => {
    const { service } = createService();
    service.onModuleInit();

    let completed = false;
    service.subscribe().subscribe({
      complete: () => {
        completed = true;
      },
    });

    service.onModuleDestroy();

    expect(completed).toBe(true);
    expect((service as unknown as { clients: Map<string, unknown> }).clients.size).toBe(0);
  });
});

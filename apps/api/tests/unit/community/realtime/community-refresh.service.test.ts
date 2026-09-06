import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityService } from '../../../../src/community/community.service';
import { CommunityRefreshService } from '../../../../src/community/realtime';

const DEBOUNCE_MS = 750;

describe('CommunityRefreshService', () => {
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };
  let checkHealth: ReturnType<typeof vi.fn>;
  let service: CommunityRefreshService;

  const makeService = (debounceMs = DEBOUNCE_MS) =>
    new CommunityRefreshService(
      logger as never,
      { checkHealth } as unknown as CommunityService,
      { get: vi.fn(() => debounceMs) } as unknown as ConfigService,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    checkHealth = vi.fn().mockResolvedValue({ status: 'active', checkedAt: '' });
    service = makeService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('probes a connection once the debounce window closes', async () => {
    service.request('conn-1', 'discord:CHANNEL_UPDATE');

    expect(checkHealth).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(checkHealth).toHaveBeenCalledExactlyOnceWith(null, 'conn-1');
  });

  it('collapses a burst of signals for one connection into a single probe', async () => {
    // One admin action on a platform fans out into several events.
    service.request('conn-1', 'discord:GUILD_ROLE_UPDATE');
    await vi.advanceTimersByTimeAsync(100);
    service.request('conn-1', 'discord:CHANNEL_UPDATE');
    await vi.advanceTimersByTimeAsync(100);
    service.request('conn-1', 'discord:CHANNEL_UPDATE');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it('probes a signal that arrives while the previous probe is still running', async () => {
    let release: () => void = () => undefined;
    checkHealth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 'active', checkedAt: '' });
        }),
    );

    service.request('conn-1', 'first');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(checkHealth).toHaveBeenCalledTimes(1);

    // The platform changed again mid-probe; the in-flight answer is already stale.
    service.request('conn-1', 'second');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    release();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(checkHealth).toHaveBeenCalledTimes(2);
  });

  it('probes several connections one at a time', async () => {
    const inFlight: string[] = [];
    let peak = 0;
    checkHealth.mockImplementation(async (_actor: unknown, id: string) => {
      inFlight.push(id);
      peak = Math.max(peak, inFlight.length);
      await Promise.resolve();
      inFlight.pop();
      return { status: 'active', checkedAt: '' };
    });

    service.request('conn-1', 'a');
    service.request('conn-2', 'b');
    service.request('conn-3', 'c');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 3_000);

    expect(checkHealth).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it('keeps draining after a probe throws', async () => {
    checkHealth.mockRejectedValueOnce(new Error('connection deleted mid-flight'));

    service.request('conn-1', 'a');
    service.request('conn-2', 'b');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 3_000);

    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(checkHealth).toHaveBeenLastCalledWith(null, 'conn-2');
  });

  it('reports how much work is outstanding', async () => {
    service.request('conn-1', 'a');
    service.request('conn-2', 'b');

    expect(service.depth).toBe(2);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 3_000);
    expect(service.depth).toBe(0);
  });

  it('probes nothing once shut down, including work already debounced', async () => {
    service.request('conn-1', 'a');
    service.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1_000);
    service.request('conn-2', 'b');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1_000);

    expect(checkHealth).not.toHaveBeenCalled();
  });
});

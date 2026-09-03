import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityService } from '../../../src/community/community.service';
import type {
  CommunityConnectionRepository,
  CommunityConnectionRow,
} from '../../../src/community/community-connection.repository';
import { CommunityHealthSweepService } from '../../../src/community/community-health-sweep.service';

const HOUR_MS = 3_600_000;

function makeRow(overrides: Partial<CommunityConnectionRow> = {}): CommunityConnectionRow {
  return {
    id: '01940000-0000-7000-8000-000000000001',
    platform: 'discord',
    externalId: 'guild-1',
    name: 'SNET',
    status: 'active',
    createdAt: new Date(Date.now() - 7 * HOUR_MS),
    updatedAt: new Date(Date.now() - 7 * HOUR_MS),
    ...overrides,
  } as CommunityConnectionRow;
}

describe('CommunityHealthSweepService', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    setContext: vi.fn(),
  };

  let connections: { findAll: ReturnType<typeof vi.fn> };
  let communityService: { checkHealth: ReturnType<typeof vi.fn> };

  const makeService = (values: Record<string, number> = {}) => {
    const configService = {
      get: vi.fn(
        (key: string) =>
          ({
            'community.healthSweep.intervalMs': 60_000,
            'community.healthSweep.activeRecheckAfterMs': 6 * HOUR_MS,
            'community.healthSweep.failedRecheckAfterMs': HOUR_MS / 2,
            'community.healthSweep.probeSpacingMs': 0,
            ...values,
          })[key],
      ),
    } as unknown as ConfigService;

    return new CommunityHealthSweepService(
      mockLogger as never,
      connections as unknown as CommunityConnectionRepository,
      communityService as unknown as CommunityService,
      configService,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    connections = { findAll: vi.fn().mockResolvedValue([]) };
    communityService = { checkHealth: vi.fn().mockResolvedValue({ status: 'active', checkedAt: '' }) };
  });

  it('stays off when the interval is 0', async () => {
    const service = makeService({ 'community.healthSweep.intervalMs': 0 });

    service.onApplicationBootstrap();

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    expect(connections.findAll).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('runs an immediate pass on bootstrap', async () => {
    const service = makeService();

    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(connections.findAll).toHaveBeenCalledTimes(1));
    service.onModuleDestroy();
  });

  it('probes only connections whose last check is older than their threshold', async () => {
    const stale = makeRow({ id: 'stale', lastCheckedAt: new Date(Date.now() - 7 * HOUR_MS) });
    const fresh = makeRow({ id: 'fresh', lastCheckedAt: new Date(Date.now() - HOUR_MS) });
    connections.findAll.mockResolvedValue([stale, fresh]);

    await makeService().sweep();

    expect(communityService.checkHealth).toHaveBeenCalledTimes(1);
    expect(communityService.checkHealth).toHaveBeenCalledWith(null, 'stale');
  });

  it('re-probes non-active connections on the shorter threshold', async () => {
    const broken = makeRow({ id: 'broken', status: 'broken', lastCheckedAt: new Date(Date.now() - HOUR_MS) });
    connections.findAll.mockResolvedValue([broken]);

    await makeService().sweep();

    expect(communityService.checkHealth).toHaveBeenCalledWith(null, 'broken');
  });

  it('never probes disconnected connections', async () => {
    connections.findAll.mockResolvedValue([makeRow({ status: 'disconnected' })]);

    await makeService().sweep();

    expect(communityService.checkHealth).not.toHaveBeenCalled();
  });

  it('falls back to the row age when a connection was never checked', async () => {
    connections.findAll.mockResolvedValue([makeRow({ id: 'unchecked', createdAt: new Date(Date.now() - HOUR_MS) })]);

    await makeService().sweep();

    expect(communityService.checkHealth).not.toHaveBeenCalled();
  });

  it('continues the pass when one probe throws', async () => {
    connections.findAll.mockResolvedValue([makeRow({ id: 'first' }), makeRow({ id: 'second' })]);
    communityService.checkHealth
      .mockRejectedValueOnce(new Error('row disconnected mid-pass'))
      .mockResolvedValueOnce({ status: 'active', checkedAt: '' });

    await makeService().sweep();

    expect(communityService.checkHealth).toHaveBeenCalledTimes(2);
    expect(communityService.checkHealth).toHaveBeenLastCalledWith(null, 'second');
  });

  it('survives a failing pass and reports it', async () => {
    connections.findAll.mockRejectedValue(new Error('database unreachable'));

    await makeService().sweep();

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('database unreachable'));
  });

  it('refuses to overlap two passes', async () => {
    let release: () => void = () => undefined;
    connections.findAll.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );

    const service = makeService();
    const first = service.sweep();
    const second = service.sweep();

    release();
    await Promise.all([first, second]);

    expect(connections.findAll).toHaveBeenCalledTimes(1);
  });

  it('paces consecutive probes with the configured spacing', async () => {
    vi.useFakeTimers();
    try {
      connections.findAll.mockResolvedValue([makeRow({ id: 'first' }), makeRow({ id: 'second' })]);
      const service = makeService({ 'community.healthSweep.probeSpacingMs': 5_000 });

      const pass = service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(communityService.checkHealth).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      await pass;
      expect(communityService.checkHealth).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a state change the sweep caused', async () => {
    connections.findAll.mockResolvedValue([makeRow({ id: 'kicked' })]);
    communityService.checkHealth.mockResolvedValue({ status: 'broken', checkedAt: '', reason: 'kicked' });

    await makeService().sweep();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'kicked', from: 'active', to: 'broken' }),
      expect.stringContaining('moved'),
    );
  });
});

import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunityConnectionStatus, CommunityFeedState, type CommunityPlatform } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { combineLatest, distinctUntilChanged, map, type Subscription } from 'rxjs';
import { CommunityService } from './community.service';
import { CommunityConnectionRepository, type CommunityConnectionRow } from './community-connection.repository';
import { CommunityEventsService } from './community-events.service';
import { CommunityRealtimeService } from './realtime';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reconciliation sweep over the community connections — the safety net behind
 * the live feeds.
 *
 * The feeds carry a platform-side change to open pages within a second, but no
 * push transport is complete. A delivery GitHub does not retry, a socket that
 * was down while an admin edited a role, and the one Discord case the
 * non-privileged intent cannot see (a role added to or removed from the bot
 * itself) all leave a row that no event will ever correct. So the sweep keeps
 * re-probing on age: `active` connections slowly, non-active ones sooner, so a
 * fix on the platform side recovers the row on its own.
 *
 * It also covers a feed that is not carrying anything. While at least one client
 * follows the events stream, the connections of any platform whose feed is not
 * live are re-probed on the fallback cadence, so a page stays as fresh as it was
 * before the feeds existed — never worse. Platforms with a live feed are left
 * alone: their changes already arrive by push.
 *
 * Freshness is read from the row itself — the same source `lastCheckedAt` is
 * served from — so every replica sees every replica's checks.
 */
@Injectable()
export class CommunityHealthSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly intervalMs: number;
  private readonly activeRecheckAfterMs: number;
  private readonly failedRecheckAfterMs: number;
  private readonly probeSpacingMs: number;
  private readonly fallbackIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private fallbackSubscription: Subscription | null = null;
  /** Platforms currently polled on the fallback cadence: watched, and not live. */
  private polled: ReadonlySet<CommunityPlatform> = new Set();
  private running = false;
  private stopping = false;

  constructor(
    @InjectPinoLogger(CommunityHealthSweepService.name)
    private readonly logger: PinoLogger,
    private readonly connections: CommunityConnectionRepository,
    private readonly communityService: CommunityService,
    private readonly events: CommunityEventsService,
    private readonly realtime: CommunityRealtimeService,
    configService: ConfigService,
  ) {
    this.intervalMs = configService.get<number>('community.healthSweep.intervalMs') ?? 900_000;
    this.activeRecheckAfterMs = configService.get<number>('community.healthSweep.activeRecheckAfterMs') ?? 21_600_000;
    this.failedRecheckAfterMs = configService.get<number>('community.healthSweep.failedRecheckAfterMs') ?? 1_800_000;
    this.probeSpacingMs = configService.get<number>('community.healthSweep.probeSpacingMs') ?? 2_000;
    this.fallbackIntervalMs = configService.get<number>('community.healthSweep.watchIntervalMs') ?? 30_000;
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) {
      this.logger.warn('Community health sweep disabled (COMMUNITY_HEALTH_SWEEP_INTERVAL_MS=0)');
    } else {
      this.timer = setInterval(() => void this.sweep(), this.intervalMs);
      this.timer.unref?.();
      // Immediate pass so connections that broke while the process was down
      // settle right after boot instead of one interval later.
      void this.sweep();
    }

    if (this.fallbackIntervalMs <= 0) {
      this.logger.warn('Community health fallback polling disabled (COMMUNITY_HEALTH_WATCH_INTERVAL_MS=0)');
      return;
    }
    // Poll a platform only while somebody is looking *and* its feed cannot tell
    // them: a live feed makes the fallback pure waste.
    this.fallbackSubscription = combineLatest([this.events.watcherCount$, this.realtime.status$])
      .pipe(
        map(([watchers, status]) =>
          watchers > 0
            ? new Set(
                (Object.keys(status.feeds) as CommunityPlatform[]).filter(
                  (platform) => status.feeds[platform] !== CommunityFeedState.live,
                ),
              )
            : new Set<CommunityPlatform>(),
        ),
        distinctUntilChanged(sameSet),
      )
      .subscribe((platforms) => this.setPolledPlatforms(platforms));
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.fallbackSubscription?.unsubscribe();
    this.fallbackSubscription = null;
    this.stopFallback();
  }

  /** Platforms being polled on the fallback cadence right now. */
  get polledPlatforms(): ReadonlySet<CommunityPlatform> {
    return this.polled;
  }

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.findDueConnections();
      for (const [index, row] of due.entries()) {
        if (this.stopping) return;
        if (index > 0 && this.probeSpacingMs > 0) {
          await sleep(this.probeSpacingMs);
        }
        await this.checkRow(row);
      }
    } catch (error) {
      // Includes the database being unreachable; the next pass retries.
      this.logger.error(`Community health sweep pass failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private setPolledPlatforms(platforms: ReadonlySet<CommunityPlatform>): void {
    if (this.stopping) return;
    this.polled = platforms;

    if (platforms.size === 0) {
      this.stopFallback();
      return;
    }
    this.logger.info(
      { platforms: [...platforms], intervalMs: this.fallbackIntervalMs },
      'Community health fallback polling covers platforms without a live feed',
    );
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => void this.sweep(), this.fallbackIntervalMs);
    this.fallbackTimer.unref?.();
    // The first pass runs at once, so a freshly opened page settles on the
    // platform's current answer rather than on the last periodic check.
    void this.sweep();
  }

  private stopFallback(): void {
    if (!this.fallbackTimer) return;
    clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    this.logger.info('Community health fallback polling stopped');
  }

  private async findDueConnections(): Promise<CommunityConnectionRow[]> {
    const rows = await this.connections.findAll();
    const now = Date.now();

    return rows.filter((row) => {
      if (row.status === CommunityConnectionStatus.disconnected) return false;
      const lastChecked = row.lastCheckedAt ?? row.createdAt;
      return now - lastChecked.getTime() >= this.thresholdFor(row);
    });
  }

  /** How stale a row may get before this pass re-probes it. */
  private thresholdFor(row: CommunityConnectionRow): number {
    // Half the cadence, so a probe that landed just after the previous tick does
    // not push the connection past the next one.
    if (this.polled.has(row.platform)) return this.fallbackIntervalMs / 2;
    return row.status === CommunityConnectionStatus.active ? this.activeRecheckAfterMs : this.failedRecheckAfterMs;
  }

  private async checkRow(row: CommunityConnectionRow): Promise<void> {
    try {
      const health = await this.communityService.checkHealth(null, row.id);
      if (health.status !== row.status) {
        this.logger.warn(
          { connectionId: row.id, platform: row.platform, from: row.status, to: health.status },
          'Health sweep moved a community connection',
        );
      }
    } catch (error) {
      // The row was deleted or disconnected since the pass began; the next
      // pass reads the new state.
      this.logger.warn(
        { connectionId: row.id, platform: row.platform },
        `Health sweep skipped a connection: ${(error as Error).message}`,
      );
    }
  }
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

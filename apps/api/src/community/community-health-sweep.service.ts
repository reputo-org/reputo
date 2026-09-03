import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunityConnectionStatus } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { distinctUntilChanged, map, type Subscription } from 'rxjs';
import { CommunityService } from './community.service';
import { CommunityConnectionRepository, type CommunityConnectionRow } from './community-connection.repository';
import { CommunityEventsService } from './community-events.service';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Periodic health sweep over the community connections, so a kicked bot or a
 * revoked token surfaces without anyone pressing Re-check.
 *
 * Each pass re-probes the connections whose last platform check is older than
 * a status-dependent threshold: active connections age slowly, non-active
 * ones are re-probed sooner so a fix on the platform side recovers the row
 * fast (`checkHealth` already writes `active` on a passing probe).
 * Disconnected connections are never probed. Probes run sequentially with a
 * pause between them, so one pass cannot burst against platform rate limits.
 *
 * While at least one client follows the connection events stream the sweep
 * switches to its watch cadence: every connection is re-probed every watch
 * interval, so a permission change on the platform shows up on the open page
 * within that interval. The cadence stops with the last client.
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
  private readonly watchIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private watcherSubscription: Subscription | null = null;
  private watching = false;
  private running = false;
  private stopping = false;

  constructor(
    @InjectPinoLogger(CommunityHealthSweepService.name)
    private readonly logger: PinoLogger,
    private readonly connections: CommunityConnectionRepository,
    private readonly communityService: CommunityService,
    private readonly events: CommunityEventsService,
    configService: ConfigService,
  ) {
    this.intervalMs = configService.get<number>('community.healthSweep.intervalMs') ?? 900_000;
    this.activeRecheckAfterMs = configService.get<number>('community.healthSweep.activeRecheckAfterMs') ?? 21_600_000;
    this.failedRecheckAfterMs = configService.get<number>('community.healthSweep.failedRecheckAfterMs') ?? 1_800_000;
    this.probeSpacingMs = configService.get<number>('community.healthSweep.probeSpacingMs') ?? 2_000;
    this.watchIntervalMs = configService.get<number>('community.healthSweep.watchIntervalMs') ?? 30_000;
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

    if (this.watchIntervalMs <= 0) {
      this.logger.warn('Community health watch cadence disabled (COMMUNITY_HEALTH_WATCH_INTERVAL_MS=0)');
      return;
    }
    this.watcherSubscription = this.events.watcherCount$
      .pipe(
        map((count) => count > 0),
        distinctUntilChanged(),
      )
      .subscribe((watched) => (watched ? this.startWatching() : this.stopWatching()));
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.watcherSubscription?.unsubscribe();
    this.watcherSubscription = null;
    this.stopWatching();
  }

  /** Whether a client is following the events stream, so the watch cadence is on. */
  get isWatching(): boolean {
    return this.watching;
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

  private startWatching(): void {
    if (this.watching || this.stopping) return;
    this.watching = true;
    this.logger.info(
      { intervalMs: this.watchIntervalMs },
      'Community health watch started: a client follows the events stream',
    );
    this.watchTimer = setInterval(() => void this.sweep(), this.watchIntervalMs);
    this.watchTimer.unref?.();
    // The first pass runs at once, so a freshly opened page settles on the
    // platform's current answer rather than on the last periodic check.
    void this.sweep();
  }

  private stopWatching(): void {
    if (!this.watching) return;
    this.watching = false;
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.logger.info('Community health watch stopped: no client follows the events stream');
  }

  private async findDueConnections(): Promise<CommunityConnectionRow[]> {
    const rows = await this.connections.findAll();
    const now = Date.now();

    return rows.filter((row) => {
      if (row.status === CommunityConnectionStatus.disconnected) return false;
      const lastChecked = row.lastCheckedAt ?? row.createdAt;
      // Half the cadence, so a probe that landed just after the previous tick
      // does not push the connection past the next one.
      const threshold = this.watching
        ? this.watchIntervalMs / 2
        : row.status === CommunityConnectionStatus.active
          ? this.activeRecheckAfterMs
          : this.failedRecheckAfterMs;
      return now - lastChecked.getTime() >= threshold;
    });
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

import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommunityConnectionStatus } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CommunityService } from './community.service';
import { CommunityAuditRepository } from './community-audit.repository';
import { CommunityConnectionRepository, type CommunityConnectionRow } from './community-connection.repository';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Periodic health sweep over the community connections, so a kicked bot or a
 * revoked token surfaces without anyone pressing Re-check.
 *
 * Each pass re-probes the connections whose last platform verification is
 * older than a status-dependent threshold: active connections age slowly,
 * non-active ones are re-probed sooner so a fix on the platform side recovers
 * the row fast (`checkHealth` already writes `active` on a passing probe).
 * Disconnected connections are never probed. Probes run sequentially with a
 * pause between them, so one pass cannot burst against platform rate limits.
 *
 * Freshness is read from the audit log — the same source `lastCheckedAt` is
 * served from — and every probe writes its own audit row with a null actor,
 * so sweep checks are visible and the next pass sees them.
 */
@Injectable()
export class CommunityHealthSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly intervalMs: number;
  private readonly activeRecheckAfterMs: number;
  private readonly failedRecheckAfterMs: number;
  private readonly probeSpacingMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;

  constructor(
    @InjectPinoLogger(CommunityHealthSweepService.name)
    private readonly logger: PinoLogger,
    private readonly connections: CommunityConnectionRepository,
    private readonly audit: CommunityAuditRepository,
    private readonly communityService: CommunityService,
    configService: ConfigService,
  ) {
    this.intervalMs = configService.get<number>('community.healthSweep.intervalMs') ?? 900_000;
    this.activeRecheckAfterMs = configService.get<number>('community.healthSweep.activeRecheckAfterMs') ?? 21_600_000;
    this.failedRecheckAfterMs = configService.get<number>('community.healthSweep.failedRecheckAfterMs') ?? 1_800_000;
    this.probeSpacingMs = configService.get<number>('community.healthSweep.probeSpacingMs') ?? 2_000;
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) {
      this.logger.warn('Community health sweep disabled (COMMUNITY_HEALTH_SWEEP_INTERVAL_MS=0)');
      return;
    }
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref?.();
    // Immediate pass so connections that broke while the process was down
    // settle right after boot instead of one interval later.
    void this.sweep();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

  private async findDueConnections(): Promise<CommunityConnectionRow[]> {
    const rows = await this.connections.findAll();
    const candidates = rows.filter((row) => row.status !== CommunityConnectionStatus.disconnected);
    const verifications = await this.audit.findLatestVerification(candidates.map((row) => row.id));
    const now = Date.now();

    return candidates.filter((row) => {
      const lastChecked = verifications.get(row.id)?.checkedAt ?? row.createdAt;
      const threshold =
        row.status === CommunityConnectionStatus.active ? this.activeRecheckAfterMs : this.failedRecheckAfterMs;
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

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CommunityService } from '../community.service';

/**
 * Pause between two probes of different connections. A live signal should reach
 * the browser fast, so this stays short; it exists only so a change touching
 * many communities at once cannot burst against a platform's rate limit.
 */
const PROBE_SPACING_MS = 250;

/**
 * Re-probes connections that a platform said had changed — coalesced, one at a
 * time, and never more than once for a burst.
 *
 * A signal is a hint, not a fact: it says a community changed, and only a probe
 * establishes the new status, metadata, and per-resource verdicts. So every
 * feed funnels through here, and the row the probe writes is what reaches
 * clients — the same path an on-demand Re-check takes. That keeps one source of
 * truth and makes duplicate signals free.
 *
 * Coalescing has two layers. Signals for one connection inside the debounce
 * window collapse into a single probe, because one admin action on a platform
 * fans out into several events. A signal that arrives while that connection's
 * probe is already running schedules exactly one more, so the final state is
 * never the stale one.
 */
@Injectable()
export class CommunityRefreshService implements OnModuleDestroy {
  private readonly debounceMs: number;
  /** Connections waiting out the debounce window, with why they were queued. */
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; reason: string }>();
  /** Connections due for a probe, in arrival order. */
  private readonly queue: string[] = [];
  private readonly reasons = new Map<string, string>();
  private draining = false;
  private stopped = false;

  constructor(
    @InjectPinoLogger(CommunityRefreshService.name)
    private readonly logger: PinoLogger,
    private readonly communityService: CommunityService,
    configService: ConfigService,
  ) {
    this.debounceMs = configService.get<number>('community.realtime.debounceMs') ?? 750;
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.queue.length = 0;
    this.reasons.clear();
  }

  /** Connections either waiting out the debounce window or queued for a probe. */
  get depth(): number {
    return this.pending.size + this.queue.length;
  }

  /**
   * Asks for a fresh probe of one connection. Returns immediately: callers are
   * event handlers on a socket or an HTTP request that must not wait on a
   * platform round trip.
   */
  request(connectionId: string, reason: string): void {
    if (this.stopped) return;

    const existing = this.pending.get(connectionId);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => this.enqueue(connectionId), this.debounceMs);
    timer.unref?.();
    this.pending.set(connectionId, { timer, reason });
  }

  private enqueue(connectionId: string): void {
    const pending = this.pending.get(connectionId);
    this.pending.delete(connectionId);
    if (this.stopped) return;

    // Already waiting for a probe: that probe will read the current state, so a
    // second one would only spend a platform request budget.
    if (!this.queue.includes(connectionId)) {
      this.queue.push(connectionId);
      this.reasons.set(connectionId, pending?.reason ?? 'live signal');
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const connectionId = this.queue.shift() as string;
        const reason = this.reasons.get(connectionId) ?? 'live signal';
        this.reasons.delete(connectionId);
        await this.probe(connectionId, reason);
        if (this.queue.length > 0) {
          await sleep(PROBE_SPACING_MS);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async probe(connectionId: string, reason: string): Promise<void> {
    try {
      const health = await this.communityService.checkHealth(null, connectionId);
      this.logger.debug(
        { connectionId, reason, status: health.status },
        'Live signal re-probed a community connection',
      );
    } catch (error) {
      // The connection was deleted or disconnected between the signal and the
      // probe. Nothing to recover: the next signal reads the row as it is.
      this.logger.debug(
        { connectionId, reason },
        `Live signal skipped a community connection: ${(error as Error).message}`,
      );
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

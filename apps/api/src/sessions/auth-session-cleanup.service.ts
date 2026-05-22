import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthSessionRepository } from './auth-session.repository';

// Periodically deletes expired AuthSession rows. Interval is driven by
// `auth.sessionCleanupIntervalMs` and can be set to 0 to disable in tests
// or other no-cron environments (e.g. CI).
@Injectable()
export class AuthSessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthSessionCleanupService.name);
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly authSessionRepository: AuthSessionRepository,
    configService: ConfigService,
  ) {
    this.intervalMs = Number(configService.get<number>('auth.sessionCleanupIntervalMs') ?? 60 * 60 * 1000);
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) return;
    this.running = true;
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // Exposed for unit tests and the soft preference of being callable on
  // demand. Deletes every AuthSession row whose `expiresAt` has passed.
  async runOnce(now: Date = new Date()): Promise<{ deletedCount: number }> {
    const result = await this.authSessionRepository.deleteExpired(now);
    if (result.deletedCount > 0) {
      this.logger.log({ msg: 'Expired auth sessions cleaned up.', deletedCount: result.deletedCount });
    }
    return result;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(async () => {
      try {
        if (!this.running) return;
        await this.runOnce();
      } catch (err) {
        this.logger.error({ msg: 'Auth session cleanup failed.', err });
      } finally {
        if (this.running) this.scheduleNext();
      }
    }, this.intervalMs);
    // Don't keep the event loop alive purely for the cleanup tick.
    this.timer.unref?.();
  }
}

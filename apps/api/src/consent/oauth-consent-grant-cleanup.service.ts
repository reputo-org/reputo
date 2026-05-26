import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthConsentGrantRepository } from './oauth-consent-grant.repository';

@Injectable()
export class OAuthConsentGrantCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OAuthConsentGrantCleanupService.name);
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly consentGrantRepository: OAuthConsentGrantRepository,
    configService: ConfigService,
  ) {
    this.intervalMs = Number(configService.get<number>('consent.grantCleanupIntervalMs') ?? 5 * 60 * 1000);
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

  async runOnce(now: Date = new Date()): Promise<{ deletedCount: number }> {
    const result = await this.consentGrantRepository.deleteExpired(now);
    if (result.deletedCount > 0) {
      this.logger.log({ msg: 'Expired OAuth consent grants cleaned up.', deletedCount: result.deletedCount });
    }
    return result;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(async () => {
      try {
        if (!this.running) return;
        await this.runOnce();
      } catch (err) {
        this.logger.error({ msg: 'OAuth consent grant cleanup failed.', err });
      } finally {
        if (this.running) this.scheduleNext();
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }
}

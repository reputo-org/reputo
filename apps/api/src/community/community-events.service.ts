import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { BehaviorSubject, Observable, Subject, type Subscription } from 'rxjs';
import { CommunityConnectionListenerService } from '../persistence';
import { CommunityService } from './community.service';
import type { CommunityConnectionEventDto } from './dto';

/** What the `community_connections` triggers put on the NOTIFY channel. */
interface ConnectionNotification {
  op?: unknown;
  id?: unknown;
}

/**
 * Keeps an idle stream alive through proxies whose inactivity timeouts would
 * otherwise cut its upstream half while the browser's half stays open, and
 * gives the client a signal to tell a quiet stream from a dead one.
 */
export const COMMUNITY_EVENTS_HEARTBEAT_MS = 15_000;

/**
 * Fans community connection changes out to SSE clients and counts them. The
 * changes arrive from PostgreSQL `NOTIFY`, so a probe run by any API replica —
 * the sweep, a Re-check, a snapshot write-back — reaches every open page.
 *
 * The client count is what turns the health sweep's watch cadence on: while
 * someone is looking, every connection is re-probed on that cadence and the
 * first event of a subscription tells the client how often.
 */
@Injectable()
export class CommunityEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, Subject<CommunityConnectionEventDto>>();
  private readonly watchers = new BehaviorSubject<number>(0);
  private readonly watchIntervalMs: number;
  private notificationSubscription: Subscription | null = null;

  constructor(
    @InjectPinoLogger(CommunityEventsService.name)
    private readonly logger: PinoLogger,
    private readonly listener: CommunityConnectionListenerService,
    private readonly communityService: CommunityService,
    configService: ConfigService,
  ) {
    this.watchIntervalMs = configService.get<number>('community.healthSweep.watchIntervalMs') ?? 30_000;
  }

  onModuleInit(): void {
    this.notificationSubscription = this.listener.notifications$.subscribe({
      next: (payload) => {
        void this.handleNotification(payload);
      },
      error: (error: Error) => {
        this.logger.error({ err: error }, 'Community connection listener stream errored');
      },
    });
  }

  onModuleDestroy(): void {
    this.notificationSubscription?.unsubscribe();
    this.notificationSubscription = null;
    for (const [clientId, subject] of this.clients) {
      subject.complete();
      this.clients.delete(clientId);
    }
    this.watchers.next(0);
    this.watchers.complete();
  }

  /** How many clients are subscribed right now, as a stream; the sweep watches it. */
  get watcherCount$(): Observable<number> {
    return this.watchers.asObservable();
  }

  get watcherCount(): number {
    return this.watchers.value;
  }

  /**
   * Subscribes one client. The first event announces the watch cadence; every
   * later one is a change or a heartbeat. Unsubscribing drops the client from
   * the count.
   */
  subscribe(): Observable<CommunityConnectionEventDto> {
    return new Observable<CommunityConnectionEventDto>((subscriber) => {
      const clientId = randomUUID();
      const subject = new Subject<CommunityConnectionEventDto>();
      this.clients.set(clientId, subject);
      this.watchers.next(this.clients.size);
      this.logger.debug({ clientId, clients: this.clients.size }, 'Community events client subscribed');

      subscriber.next({ type: 'community_connection:watch', data: { intervalMs: this.watchIntervalMs } });
      const subscription = subject.subscribe(subscriber);
      const heartbeat = setInterval(
        () => subscriber.next({ type: 'community_connection:heartbeat', data: { at: new Date().toISOString() } }),
        COMMUNITY_EVENTS_HEARTBEAT_MS,
      );

      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
        subject.complete();
        this.clients.delete(clientId);
        this.watchers.next(this.clients.size);
        this.logger.debug({ clientId, clients: this.clients.size }, 'Community events client unsubscribed');
      };
    });
  }

  private async handleNotification(payload: string): Promise<void> {
    let notification: ConnectionNotification;
    try {
      notification = JSON.parse(payload) as ConnectionNotification;
    } catch {
      this.logger.warn('Community connection NOTIFY payload is not JSON; ignoring');
      return;
    }
    if (typeof notification?.id !== 'string' || notification.id.length === 0) {
      this.logger.warn('Community connection NOTIFY payload carries no id; ignoring');
      return;
    }

    if (notification.op === 'DELETE') {
      this.broadcast({ type: 'community_connection:removed', data: { id: notification.id } });
      return;
    }

    let connection: Awaited<ReturnType<CommunityService['findById']>>;
    try {
      connection = await this.communityService.findById(notification.id);
    } catch (error) {
      this.logger.error({ err: error, connectionId: notification.id }, 'Could not load a changed community connection');
      return;
    }
    // Deleted between the NOTIFY and the read; the DELETE notification follows.
    if (!connection) return;

    this.broadcast({ type: 'community_connection:updated', data: connection });
  }

  private broadcast(event: CommunityConnectionEventDto): void {
    for (const subject of this.clients.values()) {
      subject.next(event);
    }
  }
}

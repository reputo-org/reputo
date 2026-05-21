import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { filter, Observable, Subject, type Subscription } from 'rxjs';
import { SnapshotListenerService } from '../persistence';
import type { SnapshotEventDto } from './dto';
import { SnapshotRepository, type SnapshotRow } from './snapshot.repository';

interface ClientSubscription {
  subject: Subject<SnapshotEventDto>;
  filter?: {
    algorithmPreset?: string;
  };
}

@Injectable()
export class SnapshotEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnapshotEventsService.name);
  private readonly clients = new Map<string, ClientSubscription>();
  private notificationSubscription: Subscription | null = null;

  constructor(
    private readonly listener: SnapshotListenerService,
    private readonly snapshotRepository: SnapshotRepository,
  ) {}

  onModuleInit(): void {
    this.notificationSubscription = this.listener.notifications$.subscribe({
      next: (snapshotId) => {
        void this.handleNotification(snapshotId);
      },
      error: (err) => {
        const error = err as Error;
        this.logger.error(`Listener stream errored: ${error.message}`, error.stack);
      },
    });
    this.logger.log('Subscribed to PostgreSQL snapshot notifications');
  }

  onModuleDestroy(): void {
    this.notificationSubscription?.unsubscribe();
    this.notificationSubscription = null;
    for (const [clientId, subscription] of this.clients) {
      subscription.subject.complete();
      this.clients.delete(clientId);
    }
  }

  private async handleNotification(snapshotId: string): Promise<void> {
    let row: SnapshotRow | null;
    try {
      row = await this.snapshotRepository.findById(snapshotId);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Failed to fetch snapshot ${snapshotId} for SSE: ${error.message}`, error.stack);
      return;
    }

    if (!row) {
      this.logger.debug(`Snapshot ${snapshotId} not found when handling NOTIFY — skipping broadcast`);
      return;
    }

    this.broadcast(toSnapshotEvent(row));
  }

  private broadcast(event: SnapshotEventDto): void {
    this.logger.debug(`Broadcasting event for snapshot ${event.data._id}`, {
      status: event.data.status,
      clientCount: this.clients.size,
    });

    for (const [, subscription] of this.clients) {
      subscription.subject.next(event);
    }
  }

  /**
   * Subscribe to snapshot events with optional filtering.
   * Returns an Observable that emits SnapshotEventDto when matching snapshots change.
   */
  subscribe(options?: { algorithmPreset?: string }): Observable<SnapshotEventDto> {
    const clientId = randomUUID();
    const subject = new Subject<SnapshotEventDto>();

    this.clients.set(clientId, {
      subject,
      filter: options,
    });

    this.logger.log(`Client ${clientId} subscribed`, { filter: options });

    let observable = subject.asObservable();

    if (options?.algorithmPreset) {
      observable = observable.pipe(filter((event) => event.data.algorithmPreset === options.algorithmPreset));
    }

    return new Observable((subscriber) => {
      const subscription = observable.subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        subject.complete();
        this.clients.delete(clientId);
        this.logger.log(`Client ${clientId} unsubscribed`);
      };
    });
  }
}

function toSnapshotEvent(row: SnapshotRow): SnapshotEventDto {
  return {
    type: 'snapshot:updated',
    data: {
      _id: row._id,
      status: row.status,
      algorithmPreset: row.algorithmPreset,
      outputs: row.outputs,
      startedAt: row.startedAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

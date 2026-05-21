import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, type Notification } from 'pg';
import { Subject } from 'rxjs';

export const SNAPSHOT_UPDATES_CHANNEL = 'snapshot_updates';

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Owns a dedicated long-lived PostgreSQL connection that `LISTEN`s on the
 * `snapshot_updates` channel and exposes a hot `Observable<string>` of
 * snapshot ids broadcast via `NOTIFY` from the `updateSnapshot` activity.
 *
 * The connection is intentionally separate from Prisma's pool: a single pool
 * connection pinned indefinitely to `LISTEN` would starve other queries.
 *
 * Reconnects with exponential backoff on transport errors so the channel
 * survives PG restarts. Notifications dropped during a reconnect window are
 * acceptable — SSE clients re-fetch the snapshot on (re)open of the stream.
 */
@Injectable()
export class SnapshotListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnapshotListenerService.name);
  private readonly subject = new Subject<string>();
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private destroyed = false;
  private readonly connectionString: string;

  constructor(configService: ConfigService) {
    const url = configService.get<string>('database.url');
    if (!url) {
      throw new Error('database.url is not configured');
    }
    this.connectionString = url;
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subject.complete();
    await this.disconnect();
  }

  /** Hot stream of snapshot ids parsed from NOTIFY payloads. */
  get notifications$() {
    return this.subject.asObservable();
  }

  /**
   * Constructs the underlying `pg.Client`. Exposed as protected so tests can
   * subclass to inject fakes without altering the public constructor (which
   * needs to stay DI-compatible).
   */
  protected createClient(connectionString: string): Client {
    return new Client({ connectionString });
  }

  private async connect(): Promise<void> {
    if (this.destroyed) return;

    const client = this.createClient(this.connectionString);
    this.client = client;

    client.on('notification', (msg: Notification) => this.handleNotification(msg));
    client.on('error', (err: Error) => this.handleError(err));
    client.on('end', () => this.handleEnd());

    try {
      await client.connect();
      await client.query(`LISTEN ${SNAPSHOT_UPDATES_CHANNEL}`);
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.logger.log(`Listening on PostgreSQL channel "${SNAPSHOT_UPDATES_CHANNEL}"`);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Failed to establish LISTEN connection: ${error.message}`, error.stack);
      await this.disconnect();
      this.scheduleReconnect();
    }
  }

  private async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    client.removeAllListeners('notification');
    client.removeAllListeners('error');
    client.removeAllListeners('end');
    try {
      await client.end();
    } catch (err) {
      const error = err as Error;
      this.logger.debug(`Error closing LISTEN connection: ${error.message}`);
    }
  }

  private handleNotification(msg: Notification): void {
    if (msg.channel !== SNAPSHOT_UPDATES_CHANNEL) return;
    const snapshotId = msg.payload?.trim();
    if (!snapshotId) {
      this.logger.warn('Received NOTIFY with empty payload — ignoring');
      return;
    }
    this.subject.next(snapshotId);
  }

  private handleError(err: Error): void {
    this.logger.error(`LISTEN connection error: ${err.message}`, err.stack);
    void this.recover();
  }

  private handleEnd(): void {
    if (this.destroyed) return;
    this.logger.warn('LISTEN connection ended — scheduling reconnect');
    void this.recover();
  }

  private async recover(): Promise<void> {
    if (this.destroyed) return;
    await this.disconnect();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    this.logger.log(`Reconnecting to PostgreSQL LISTEN channel in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}

import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Client, type Notification } from 'pg';
import { Subject } from 'rxjs';

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
/** A round trip on the LISTEN connection this often; see `checkConnection`. */
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_QUERY_TIMEOUT_MS = 10_000;

/** The application database URL, required by every listener. */
export function requireDatabaseUrl(configService: ConfigService): string {
  const url = configService.get<string>('database.url');
  if (!url) {
    throw new Error('database.url is not configured');
  }
  return url;
}

/**
 * Owns a dedicated long-lived PostgreSQL connection that `LISTEN`s on one
 * channel and exposes a hot `Observable<string>` of the `NOTIFY` payloads.
 *
 * The connection is intentionally separate from the ORM pool: a single pool
 * connection pinned indefinitely to `LISTEN` would starve other queries.
 *
 * Reconnects with exponential backoff on transport errors so the channel
 * survives PG restarts, and checks the connection with a query every half
 * minute so one that died silently behind a proxy is reconnected rather than
 * left listening to nothing. Notifications dropped during a reconnect window
 * are acceptable — SSE clients re-fetch on (re)open of the stream.
 */
export abstract class PostgresChannelListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private readonly subject = new Subject<string>();
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private checking = false;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private destroyed = false;

  protected constructor(
    private readonly channel: string,
    private readonly connectionString: string,
    loggerName: string,
  ) {
    this.logger = new Logger(loggerName);
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

  /** Hot stream of the NOTIFY payloads received on the channel. */
  get notifications$() {
    return this.subject.asObservable();
  }

  /**
   * Constructs the underlying `pg.Client`. Exposed as protected so tests can
   * subclass to inject fakes without altering the public constructor (which
   * needs to stay DI-compatible).
   */
  protected createClient(connectionString: string): Client {
    // TCP keepalive so NAT and proxy tables between the API and Postgres do
    // not idle the socket out; the query timeout turns a hung check into a
    // failed one.
    return new Client({
      connectionString,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      query_timeout: HEALTH_CHECK_QUERY_TIMEOUT_MS,
    });
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
      await client.query(`LISTEN ${this.channel}`);
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.startHealthCheck(client);
      this.logger.log(`Listening on PostgreSQL channel "${this.channel}"`);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Failed to establish LISTEN connection: ${error.message}`, error.stack);
      await this.disconnect();
      this.scheduleReconnect();
    }
  }

  private async disconnect(): Promise<void> {
    this.stopHealthCheck();
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

  private startHealthCheck(client: Client): void {
    this.stopHealthCheck();
    this.healthTimer = setInterval(() => void this.checkConnection(client), HEALTH_CHECK_INTERVAL_MS);
    this.healthTimer.unref?.();
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /**
   * One round trip on the LISTEN connection. It proves the connection is still
   * alive end to end, and its response carries along any notification a proxy
   * had been holding back on an otherwise idle socket. A failed check
   * reconnects, which re-issues LISTEN on a fresh connection.
   */
  private async checkConnection(client: Client): Promise<void> {
    if (this.destroyed || client !== this.client || this.checking) return;
    this.checking = true;
    try {
      await client.query('SELECT 1');
    } catch (err) {
      const error = err as Error;
      this.logger.warn(`LISTEN connection health check failed: ${error.message} — reconnecting`);
      await this.recover();
    } finally {
      this.checking = false;
    }
  }

  private handleNotification(msg: Notification): void {
    if (msg.channel !== this.channel) return;
    const payload = msg.payload?.trim();
    if (!payload) {
      this.logger.warn('Received NOTIFY with empty payload — ignoring');
      return;
    }
    this.subject.next(payload);
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

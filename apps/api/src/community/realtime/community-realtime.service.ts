import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommunityAuthError,
  type CommunityRealtimeSource,
  CommunityRealtimeState,
  type CommunitySignal,
  parseMattermostExternalId,
  toGitHubWebhookSignal,
} from '@reputo/community-api';
import {
  CommunityConnectionStatus,
  CommunityFeedState,
  CommunityPlatform,
  type CommunityRealtimeStatusDto,
} from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { BehaviorSubject, type Observable, type Subscription } from 'rxjs';
import { CommunityConnectionListenerService } from '../../persistence';
import { CommunityConnectionRepository } from '../community-connection.repository';
import { CommunityCredentialsService } from '../community-credentials.service';
import { COMMUNITY_REALTIME_SOURCES, type CommunityRealtimeSourceFactory } from './community-realtime.sources';
import { CommunityRefreshService } from './community-refresh.service';

/** Feed state a source's transport state maps onto. */
const FEED_STATE_BY_SOURCE_STATE: Record<CommunityRealtimeState, CommunityFeedState> = {
  [CommunityRealtimeState.live]: CommunityFeedState.live,
  [CommunityRealtimeState.connecting]: CommunityFeedState.connecting,
  [CommunityRealtimeState.retrying]: CommunityFeedState.connecting,
  [CommunityRealtimeState.stopped]: CommunityFeedState.down,
  [CommunityRealtimeState.fatal]: CommunityFeedState.down,
};

/**
 * Follows the platforms' own live feeds so a change on a platform reaches open
 * pages as it happens, instead of being discovered by the next poll.
 *
 * Each platform pushes through the only transport it offers: Discord over a
 * Gateway socket, Mattermost over a WebSocket per connected team, GitHub over
 * App webhook deliveries (which arrive at the webhook controller and are handed
 * to `ingestGitHubDelivery`). All three normalize to the same signal, and every
 * signal ends in one coalesced re-probe — the probe, not the event, is what
 * decides status and per-resource read verdicts.
 *
 * The Mattermost feed needs one socket per connection, so the set of sockets is
 * reconciled against the connections table: at boot, and again on every
 * connection change, which arrives on the same `NOTIFY` channel that drives the
 * SSE stream. A connect therefore starts following its team without a restart.
 *
 * Feeds never gate correctness. A source that is down leaves its platform on
 * the reconciliation sweep's polling, and `status$` says which platforms are in
 * which mode, so an open page can tell the operator the truth.
 */
@Injectable()
export class CommunityRealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly enabled: boolean;
  private readonly githubWebhookSecret?: string;
  private readonly fallbackIntervalMs: number;
  private discord: CommunityRealtimeSource | null = null;
  /** One Mattermost source per connection external id. */
  private readonly mattermost = new Map<string, CommunityRealtimeSource>();
  private readonly unsubscribes = new Map<string, Array<() => void>>();
  private readonly statusSubject: BehaviorSubject<CommunityRealtimeStatusDto>;
  private connectionsSubscription: Subscription | null = null;
  private reconciling: Promise<void> | null = null;
  private stopped = false;

  constructor(
    @InjectPinoLogger(CommunityRealtimeService.name)
    private readonly logger: PinoLogger,
    private readonly connections: CommunityConnectionRepository,
    private readonly credentials: CommunityCredentialsService,
    private readonly refresh: CommunityRefreshService,
    private readonly listener: CommunityConnectionListenerService,
    @Inject(COMMUNITY_REALTIME_SOURCES)
    private readonly sources: CommunityRealtimeSourceFactory,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<boolean>('community.realtime.enabled') ?? true;
    this.githubWebhookSecret = configService.get<string>('community.realtime.githubWebhookSecret');
    this.fallbackIntervalMs = configService.get<number>('community.healthSweep.watchIntervalMs') ?? 30_000;
    this.statusSubject = new BehaviorSubject<CommunityRealtimeStatusDto>(this.buildStatus());
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.warn('Community live feeds disabled (COMMUNITY_REALTIME_ENABLED=false); the sweep polls instead');
      return;
    }
    if (this.githubWebhookSecret === undefined) {
      this.logger.warn(
        'No GITHUB_APP_WEBHOOK_SECRET: GitHub deliveries are refused and GitHub connections fall back to polling',
      );
    }

    // A connect, disconnect, or removal changes which feeds are needed, and it
    // reaches every replica on this channel already.
    this.connectionsSubscription = this.listener.notifications$.subscribe({
      next: () => void this.reconcile(),
      error: (error: Error) =>
        this.logger.error({ err: error }, 'Community connection listener stream errored; the feed set may go stale'),
    });
    void this.reconcile();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.connectionsSubscription?.unsubscribe();
    this.connectionsSubscription = null;

    const sources = [...(this.discord ? [this.discord] : []), ...this.mattermost.values()];
    this.discord = null;
    this.mattermost.clear();
    for (const teardown of this.unsubscribes.values()) {
      for (const unsubscribe of teardown) unsubscribe();
    }
    this.unsubscribes.clear();
    await Promise.all(sources.map((source) => source.stop().catch(() => undefined)));
    this.statusSubject.complete();
  }

  /** Feed state per platform, and the cadence a platform without a feed is polled at. */
  get status(): CommunityRealtimeStatusDto {
    return this.statusSubject.value;
  }

  get status$(): Observable<CommunityRealtimeStatusDto> {
    return this.statusSubject.asObservable();
  }

  /** Whether this platform's changes are arriving by push right now. */
  isLive(platform: CommunityPlatform): boolean {
    return this.status.feeds[platform] === CommunityFeedState.live;
  }

  /**
   * Handles one verified GitHub App delivery. The signature is checked by the
   * controller, so this only maps the event and hands it on; an event that says
   * nothing about read access, or names an installation Reputo does not track,
   * is dropped.
   */
  async ingestGitHubDelivery(event: string, payload: unknown): Promise<void> {
    if (!this.enabled) return;
    const signal = toGitHubWebhookSignal(event, payload);
    if (signal === null) return;
    await this.handleSignal(signal);
  }

  /**
   * Brings the open feeds in line with the connections table: a Gateway socket
   * while any Discord community is connected, one Mattermost socket per
   * connected team, and nothing for a platform nobody uses. Runs one pass at a
   * time, because it is driven by a notification stream that can fire several
   * times in a row.
   */
  private reconcile(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.reconciling) return this.reconciling;

    const pass = this.runReconciliation().finally(() => {
      this.reconciling = null;
    });
    this.reconciling = pass;
    return pass;
  }

  private async runReconciliation(): Promise<void> {
    let rows: Awaited<ReturnType<CommunityConnectionRepository['findAll']>>;
    try {
      rows = await this.connections.findAll();
    } catch (error) {
      // The next notification or the next boot retries; the sweep covers the gap.
      this.logger.error({ err: error }, 'Could not read the connections to supervise their live feeds');
      return;
    }

    const followed = rows.filter((row) => row.status !== CommunityConnectionStatus.disconnected);
    await this.reconcileDiscord(followed.some((row) => row.platform === CommunityPlatform.discord));
    await this.reconcileMattermost(
      new Set(followed.filter((row) => row.platform === CommunityPlatform.mattermost).map((row) => row.externalId)),
    );
    this.publishStatus();
  }

  /** One socket serves every Discord community, so it follows whether any exists. */
  private async reconcileDiscord(wanted: boolean): Promise<void> {
    if (wanted === (this.discord !== null)) return;

    if (!wanted) {
      const source = this.discord;
      this.discord = null;
      this.untrack('discord');
      await source?.stop().catch(() => undefined);
      this.logger.info('Stopped following the Discord gateway: no Discord community is connected');
      return;
    }

    const source = this.sources.discord();
    this.discord = source;
    this.track('discord', source);
    source.start();
    this.logger.info('Following the Discord gateway');
  }

  private async reconcileMattermost(wanted: Set<string>): Promise<void> {
    for (const [externalId, source] of this.mattermost) {
      if (wanted.has(externalId)) continue;
      this.mattermost.delete(externalId);
      this.untrack(`mattermost:${externalId}`);
      await source.stop().catch(() => undefined);
      this.logger.info({ externalId }, 'Stopped following a Mattermost team');
    }

    for (const externalId of wanted) {
      if (this.mattermost.has(externalId) || this.stopped) continue;
      this.startMattermost(externalId);
    }
  }

  private startMattermost(externalId: string): void {
    let serverUrl: string;
    let teamId: string;
    try {
      ({ serverUrl, teamId } = parseMattermostExternalId(externalId));
    } catch (error) {
      this.logger.warn({ externalId, err: error }, 'Skipping a Mattermost connection with an unreadable id');
      return;
    }

    const source = this.sources.mattermost({
      serverUrl,
      teamId,
      resolveToken: () => this.openMattermostToken(externalId),
    });
    this.mattermost.set(externalId, source);
    this.track(`mattermost:${externalId}`, source);
    source.start();
    this.logger.info({ externalId }, 'Following a Mattermost team');
  }

  /**
   * Unseals the bot token for one connection attempt. The socket asks per
   * attempt rather than holding the plaintext, so a rotated or removed
   * credential takes effect on the next reconnect.
   */
  private async openMattermostToken(externalId: string): Promise<string> {
    const platform = CommunityPlatform.mattermost;
    const ciphertext = await this.connections.findCredentialsCiphertext(platform, externalId);
    if (ciphertext === null) {
      throw new CommunityAuthError('No sealed token is stored for this connection.', 401);
    }
    return this.credentials.open({ platform, externalId }, ciphertext);
  }

  /** Subscribes to a source's signals and state, remembering how to detach. */
  private track(key: string, source: CommunityRealtimeSource): void {
    this.unsubscribes.set(key, [
      source.onSignal((signal) => void this.handleSignal(signal)),
      source.onStateChange((state) => {
        this.logger.info({ platform: source.platform, feed: source.key, state }, 'Community live feed changed state');
        this.publishStatus();
      }),
    ]);
  }

  private untrack(key: string): void {
    for (const unsubscribe of this.unsubscribes.get(key) ?? []) unsubscribe();
    this.unsubscribes.delete(key);
  }

  /**
   * Resolves a platform's own community id to a connection and asks for a fresh
   * probe. A signal for a community Reputo does not track is dropped here: the
   * Discord bot can be in guilds nobody connected, and a GitHub App can be
   * installed on accounts nobody connected.
   */
  private async handleSignal(signal: CommunitySignal): Promise<void> {
    if (this.stopped) return;

    let connection: Awaited<ReturnType<CommunityConnectionRepository['findByPlatformExternalId']>>;
    try {
      connection = await this.connections.findByPlatformExternalId(signal.platform, signal.externalId);
    } catch (error) {
      this.logger.error({ err: error, platform: signal.platform }, 'Could not resolve a live signal to a connection');
      return;
    }
    if (!connection) {
      this.logger.debug(
        { platform: signal.platform, event: signal.event },
        'Live signal names a community Reputo does not track; ignoring',
      );
      return;
    }
    if (connection.status === CommunityConnectionStatus.disconnected) return;

    this.logger.debug(
      { connectionId: connection.id, platform: signal.platform, event: signal.event, kind: signal.kind },
      'Live signal received',
    );
    this.refresh.request(connection.id, `${signal.platform}:${signal.event}`);
  }

  private publishStatus(): void {
    if (this.stopped) return;
    const next = this.buildStatus();
    const current = this.statusSubject.value;
    const changed =
      next.fallbackIntervalMs !== current.fallbackIntervalMs ||
      COMMUNITY_PLATFORM_LIST.some((platform) => next.feeds[platform] !== current.feeds[platform]);
    if (changed) {
      this.statusSubject.next(next);
    }
  }

  private buildStatus(): CommunityRealtimeStatusDto {
    return {
      feeds: {
        [CommunityPlatform.discord]: this.discordFeedState(),
        [CommunityPlatform.github]: this.githubFeedState(),
        [CommunityPlatform.mattermost]: this.mattermostFeedState(),
      },
      fallbackIntervalMs: this.fallbackIntervalMs,
    };
  }

  private discordFeedState(): CommunityFeedState {
    if (!this.enabled || this.discord === null) return CommunityFeedState.down;
    return FEED_STATE_BY_SOURCE_STATE[this.discord.state];
  }

  /**
   * GitHub pushes rather than holding a socket, so there is nothing to observe:
   * a configured, signed webhook is the live state. Delivery is GitHub's job,
   * and the sweep still reconciles whatever a delivery missed.
   */
  private githubFeedState(): CommunityFeedState {
    return this.enabled && this.githubWebhookSecret !== undefined ? CommunityFeedState.live : CommunityFeedState.down;
  }

  /** Live only when every supervised team has an open socket — one broken team is a gap. */
  private mattermostFeedState(): CommunityFeedState {
    if (!this.enabled) return CommunityFeedState.down;
    const states = [...this.mattermost.values()].map((source) => FEED_STATE_BY_SOURCE_STATE[source.state]);
    if (states.length === 0) return CommunityFeedState.live;
    if (states.every((state) => state === CommunityFeedState.live)) return CommunityFeedState.live;
    return states.some((state) => state === CommunityFeedState.connecting)
      ? CommunityFeedState.connecting
      : CommunityFeedState.down;
  }
}

const COMMUNITY_PLATFORM_LIST = Object.values(CommunityPlatform);

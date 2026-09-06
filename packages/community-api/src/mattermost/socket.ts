import type { CommunityLogger } from '../shared/http.js';
import type {
  CommunityRealtimeBackoff,
  CommunityRealtimeSource,
  CommunityRealtimeState,
  CommunitySignalKind,
} from '../shared/realtime.js';
import { createReconnectingSocket } from '../shared/reconnecting-socket.js';
import { createPinnedDispatcher, resolvePinnedTarget } from '../shared/safe-fetch.js';
import { createMattermostRequest } from './request.js';
import {
  buildMattermostExternalId,
  type MattermostSocketFrame,
  normalizeMattermostServerUrl,
  readMattermostEvent,
} from './transform.js';
import { MATTERMOST_API_PATH, type MattermostClientConfig, type MattermostRawUser } from './types.js';

const WEBSOCKET_PATH = `${MATTERMOST_API_PATH}/websocket`;

/**
 * Mattermost drops an unauthenticated socket without a distinguishing close
 * code, so a rejected token looks like any other disconnect and is retried
 * rather than treated as fatal: a token an admin re-enables recovers on its
 * own, and the probe behind each signal is what reports `broken` meanwhile.
 *
 * Mattermost keeps the socket busy with its own pings, so silence well past
 * that is a dead socket the operating system has not reported.
 */
const IDLE_TIMEOUT_MS = 120_000;

/**
 * One team's socket, without its credential. The token is fetched per
 * connection attempt instead of being held for the life of the source, so an
 * unsealed token never outlives the handshake that needs it.
 */
export interface MattermostSocketTarget {
  serverUrl: string;
  teamId: string;
  /** Unseals the bot token for exactly one connection attempt. */
  resolveToken(): Promise<string>;
}

/**
 * The Mattermost half of the realtime layer. Mattermost's outgoing webhooks
 * fire on messages, not on configuration, so the WebSocket API is the only
 * transport that reports a channel appearing or the bot being invited to one.
 *
 * One socket per connected team, because the credential is per connection. The
 * token reaches the server as an upgrade header — never as a frame, never in a
 * log line — and is unsealed per attempt rather than retained.
 *
 * The server origin is admin-entered, so the socket dials through the same
 * outbound policy as every Mattermost HTTP call: the origin is validated and
 * resolved once per attempt, and the connection is pinned to those addresses.
 *
 * The socket also carries message events. They are dropped without being read:
 * this package never touches content, and a signal names an event, never a
 * payload.
 */
export function createMattermostSocket(
  config: MattermostClientConfig,
  target: MattermostSocketTarget,
  logger: CommunityLogger,
  backoff?: CommunityRealtimeBackoff,
): CommunityRealtimeSource {
  const origin = normalizeMattermostServerUrl(target.serverUrl);
  const externalId = buildMattermostExternalId(origin, target.teamId);
  const call = createMattermostRequest(config, logger);
  let botUserId: string | undefined;

  /**
   * The bot's own user id, so membership events can be narrowed to the bot.
   * Resolved once and kept for the life of the source; a failure leaves it
   * unknown, and the filter then lets membership events through — more probes,
   * never fewer.
   */
  const resolveBotUserId = async (token: string): Promise<void> => {
    if (botUserId !== undefined) return;
    try {
      const response = await call<MattermostRawUser>({ serverUrl: origin, token }, 'GET', '/users/me');
      const id = (response.data as { id?: unknown } | null)?.id;
      if (typeof id === 'string' && id.length > 0) botUserId = id;
    } catch {
      logger.warn({
        platform: 'mattermost',
        message: 'Bot identity lookup failed; membership events stay unfiltered.',
      });
    }
  };

  const socket = createReconnectingSocket(
    {
      async open() {
        const token = await target.resolveToken();
        await resolveBotUserId(token);
        // The policy check runs against the http(s) origin, exactly as the REST
        // calls do; only the scheme differs on the socket itself.
        const pinned = await resolvePinnedTarget(origin, config.outbound);
        const scheme = pinned.url.protocol === 'https:' ? 'wss:' : 'ws:';
        return {
          url: `${scheme}//${pinned.url.host}${WEBSOCKET_PATH}`,
          headers: { authorization: `Bearer ${token}` },
          dispatcher: createPinnedDispatcher(pinned, { connectTimeoutMs: config.requestTimeoutMs }),
        };
      },

      onMessage(payload, handle) {
        let frame: MattermostSocketFrame;
        try {
          frame = JSON.parse(payload) as MattermostSocketFrame;
        } catch {
          logger.warn({ platform: 'mattermost', message: 'Socket sent a frame that is not JSON; ignoring.' });
          return;
        }

        // `hello` is the server's acknowledgement that the upgrade authenticated.
        if (frame.event === 'hello') {
          handle.markLive();
          return;
        }
        const kind = readMattermostEvent(frame, { teamId: target.teamId, botUserId });
        if (kind !== null) {
          emit(kind, String(frame.event));
        }
      },

      idleTimeoutMs: IDLE_TIMEOUT_MS,
      backoff,
    },
    logger,
    `mattermost-socket:${target.teamId}`,
  );

  function emit(kind: CommunitySignalKind, event: string): void {
    socket.emitSignal({ platform: 'mattermost', externalId, kind, event, at: new Date() });
  }

  return {
    platform: 'mattermost',
    key: externalId,
    get state(): CommunityRealtimeState {
      return socket.state;
    },
    start: socket.start,
    stop: socket.stop,
    onSignal: socket.onSignal,
    onStateChange: socket.onStateChange,
  };
}

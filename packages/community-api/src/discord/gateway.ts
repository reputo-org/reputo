import { type CommunityLogger, executeRequest } from '../shared/http.js';
import {
  type CommunityRealtimeBackoff,
  type CommunityRealtimeSource,
  type CommunityRealtimeState,
  CommunitySignalKind,
} from '../shared/realtime.js';
import { createReconnectingSocket, type SocketHandle } from '../shared/reconnecting-socket.js';
import { readDiscordDispatch } from './transform.js';
import { DISCORD_API_BASE_URL, DISCORD_GATEWAY_INTENTS, type DiscordAdapterConfig } from './types.js';

/** Gateway protocol version and payload encoding this client speaks. */
const GATEWAY_QUERY = 'v=10&encoding=json';

/** Fallback when `GET /gateway/bot` cannot be reached; Discord documents it as stable. */
const GATEWAY_FALLBACK_URL = 'wss://gateway.discord.gg';

const GatewayOpcode = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
} as const;

/**
 * Closes Discord will keep refusing: a rejected token, a shard or API version
 * this client does not speak, an intent the application is not allowed to use.
 * Everything else — including 4007 and 4009, which only invalidate the session
 * — is retried.
 */
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

/** Closes that invalidate the session, so the next attempt must identify afresh. */
const SESSION_LOST_CLOSE_CODES = new Set([4007, 4009]);

/** Discord asks for a re-identify no sooner than 1 s and no later than 5 s after an invalid session. */
const INVALID_SESSION_DELAY_MS = { min: 1_000, max: 5_000 };

interface GatewayPayload {
  op?: unknown;
  d?: unknown;
  s?: unknown;
  t?: unknown;
}

interface GatewayBotResponse {
  url?: unknown;
}

/**
 * The Discord half of the realtime layer. Discord publishes no webhook for
 * guild state, so the Gateway is the only push transport: one socket for the
 * whole bot, carrying every guild it is in.
 *
 * It runs on the `GUILDS` intent alone — non-privileged, in keeping with the
 * bot's read-only install — which delivers channel, role, and guild lifecycle
 * events. A change to which *roles the bot itself holds* arrives as
 * `GUILD_MEMBER_UPDATE`, which needs the privileged `GUILD_MEMBERS` intent, so
 * that one case waits for a Re-check rather than being bought with a privileged
 * intent.
 *
 * The source emits signals only; it never resolves permissions itself. A probe
 * decides what a signal meant, so the Gateway cannot drift from the REST view
 * that snapshots actually depend on.
 */
export function createDiscordGateway(
  config: DiscordAdapterConfig,
  logger: CommunityLogger,
  backoff?: CommunityRealtimeBackoff,
): CommunityRealtimeSource {
  let sessionId: string | undefined;
  let resumeUrl: string | undefined;
  let sequence: number | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let awaitingAck = false;
  /**
   * Guilds the current session is still hydrating. Discord replays a
   * `GUILD_CREATE` for every guild right after `READY`; those describe the
   * state we are about to probe anyway, so they are absorbed rather than
   * turned into a signal storm on every reconnect.
   */
  let hydrating = new Set<string>();

  const clearHeartbeat = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    awaitingAck = false;
  };

  const dropSession = (): void => {
    sessionId = undefined;
    resumeUrl = undefined;
    sequence = null;
    hydrating = new Set();
  };

  /** Discord's advertised gateway, or the documented fallback when the lookup fails. */
  const fetchGatewayUrl = async (): Promise<string> => {
    try {
      const response = await executeRequest<GatewayBotResponse>(logger, config, {
        method: 'GET',
        url: `${DISCORD_API_BASE_URL}/gateway/bot`,
        headers: { authorization: `Bot ${config.botToken}` },
      });
      const url = response.data?.url;
      return typeof url === 'string' && url.startsWith('wss://') ? url : GATEWAY_FALLBACK_URL;
    } catch {
      logger.warn({ platform: 'discord', message: 'Gateway lookup failed; using the documented gateway URL.' });
      return GATEWAY_FALLBACK_URL;
    }
  };

  const startHeartbeat = (socket: SocketHandle, intervalMs: number): void => {
    clearHeartbeat();
    const beat = (): void => {
      // No ack since the previous beat means a zombie connection: the socket is
      // open but Discord is not reading it. Resume rather than wait it out.
      if (awaitingAck) {
        socket.reconnect('no heartbeat ack');
        return;
      }
      awaitingAck = true;
      socket.send(JSON.stringify({ op: GatewayOpcode.heartbeat, d: sequence }));
    };

    // The first beat is jittered inside the interval, as Discord requires, so
    // many bots reconnecting together do not beat in lockstep.
    setTimeout(
      () => {
        if (heartbeatTimer === null) return;
        beat();
      },
      Math.round(Math.random() * intervalMs),
    ).unref?.();
    heartbeatTimer = setInterval(beat, intervalMs);
    heartbeatTimer.unref?.();
  };

  const identify = (socket: SocketHandle): void => {
    socket.send(
      JSON.stringify({
        op: GatewayOpcode.identify,
        d: {
          token: config.botToken,
          intents: DISCORD_GATEWAY_INTENTS,
          properties: { os: process.platform, browser: 'reputo', device: 'reputo' },
        },
      }),
    );
  };

  const resumeOrIdentify = (socket: SocketHandle): void => {
    if (sessionId === undefined || sequence === null) {
      identify(socket);
      return;
    }
    socket.send(
      JSON.stringify({
        op: GatewayOpcode.resume,
        d: { token: config.botToken, session_id: sessionId, seq: sequence },
      }),
    );
  };

  const socket = createReconnectingSocket(
    {
      async open() {
        // A resume must go to the URL READY handed out; a fresh session may not.
        const base = sessionId !== undefined ? (resumeUrl ?? (await fetchGatewayUrl())) : await fetchGatewayUrl();
        return { url: `${base}/?${GATEWAY_QUERY}` };
      },

      onDisconnect(code) {
        clearHeartbeat();
        if (SESSION_LOST_CLOSE_CODES.has(code)) {
          dropSession();
        }
      },

      isFatalClose(code) {
        return FATAL_CLOSE_CODES.has(code);
      },

      onMessage(payload, handle) {
        let frame: GatewayPayload;
        try {
          frame = JSON.parse(payload) as GatewayPayload;
        } catch {
          logger.warn({ platform: 'discord', message: 'Gateway sent a frame that is not JSON; ignoring.' });
          return;
        }
        if (typeof frame.s === 'number') {
          sequence = frame.s;
        }

        switch (frame.op) {
          case GatewayOpcode.hello: {
            const interval = (frame.d as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval;
            if (typeof interval !== 'number' || interval <= 0) {
              handle.reconnect('hello without a heartbeat interval');
              return;
            }
            startHeartbeat(handle, interval);
            resumeOrIdentify(handle);
            return;
          }
          case GatewayOpcode.heartbeatAck:
            awaitingAck = false;
            return;
          case GatewayOpcode.heartbeat:
            awaitingAck = false;
            handle.send(JSON.stringify({ op: GatewayOpcode.heartbeat, d: sequence }));
            return;
          case GatewayOpcode.reconnect:
            handle.reconnect('gateway asked for a reconnect');
            return;
          case GatewayOpcode.invalidSession: {
            // `d: false` means the session cannot be resumed at all.
            if (frame.d !== true) dropSession();
            const delay =
              INVALID_SESSION_DELAY_MS.min +
              Math.random() * (INVALID_SESSION_DELAY_MS.max - INVALID_SESSION_DELAY_MS.min);
            setTimeout(() => handle.reconnect('invalid session'), delay).unref?.();
            return;
          }
          case GatewayOpcode.dispatch:
            handleDispatch(frame, handle);
            return;
          default:
            return;
        }
      },

      // Discord heartbeats every ~41 s, so silence far past that is a dead
      // socket the operating system has not told us about.
      idleTimeoutMs: 120_000,
      backoff,
    },
    logger,
    'discord-gateway',
  );

  function handleDispatch(frame: GatewayPayload, handle: SocketHandle): void {
    const event = typeof frame.t === 'string' ? frame.t : '';
    const data = (frame.d ?? {}) as Record<string, unknown>;

    if (event === 'READY') {
      sessionId = typeof data.session_id === 'string' ? data.session_id : undefined;
      resumeUrl = typeof data.resume_gateway_url === 'string' ? data.resume_gateway_url : undefined;
      hydrating = new Set(
        (Array.isArray(data.guilds) ? data.guilds : [])
          .map((guild) => (guild as { id?: unknown } | null)?.id)
          .filter((id): id is string => typeof id === 'string'),
      );
      handle.markLive();
      logger.debug({ platform: 'discord', message: `Gateway ready; ${hydrating.size} guild(s) to hydrate.` });
      return;
    }
    if (event === 'RESUMED') {
      handle.markLive();
      return;
    }

    const meaning = readDiscordDispatch(event, frame.d);
    switch (meaning.type) {
      case 'available':
        // A session replays a GUILD_CREATE for every guild it already had;
        // those describe the state a probe would find anyway, so only a guild
        // outside the replay set is a fresh install.
        if (!hydrating.delete(meaning.guildId)) {
          emit(meaning.guildId, CommunitySignalKind.community, event);
        }
        return;
      case 'outage':
        // The guild returns with a GUILD_CREATE, which must not read as a join.
        hydrating.add(meaning.guildId);
        return;
      case 'changed':
        emit(meaning.guildId, meaning.kind, event);
        return;
      case 'ignored':
        return;
    }
  }

  function emit(externalId: string, kind: CommunitySignalKind, event: string): void {
    socket.emitSignal({ platform: 'discord', externalId, kind, event, at: new Date() });
  }

  return {
    platform: 'discord',
    key: 'bot',
    get state(): CommunityRealtimeState {
      return socket.state;
    },
    start: socket.start,
    async stop(): Promise<void> {
      clearHeartbeat();
      dropSession();
      await socket.stop();
    },
    onSignal: socket.onSignal,
    onStateChange: socket.onStateChange,
  };
}

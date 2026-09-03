import type { Dispatcher } from 'undici';
import { WebSocket } from 'undici';
import type { CommunityLogger } from './http.js';
import {
  type CommunityRealtimeBackoff,
  CommunityRealtimeState,
  createSignalEmitter,
  DEFAULT_REALTIME_BACKOFF,
  realtimeReconnectDelay,
} from './realtime.js';

/** Normal closure, so the peer knows the disconnect was deliberate. */
const NORMAL_CLOSURE = 1000;

/** Where one connection attempt should dial, resolved per attempt. */
export interface SocketTarget {
  /** `ws://` or `wss://` URL. */
  url: string;
  /** Upgrade-request headers — how a token reaches the server without ever being sent as a frame. */
  headers?: Record<string, string>;
  /** Address-pinned dispatcher, for a server whose origin an admin entered. */
  dispatcher?: Dispatcher;
}

/** What a protocol handler may do to the socket it is driving. */
export interface SocketHandle {
  /** Sends one text frame. A send on a socket that is not open is dropped, not thrown. */
  send(payload: string): void;
  /** The protocol's handshake completed: the feed is now trustworthy. */
  markLive(): void;
  /** Tears the socket down and reconnects after backoff. */
  reconnect(reason: string): void;
}

export interface ReconnectingSocketOptions {
  /** Resolves the target for one attempt, so a rotated credential or a re-pinned address is picked up per attempt. */
  open(): Promise<SocketTarget>;
  onOpen?(socket: SocketHandle): void;
  onMessage(payload: string, socket: SocketHandle): void;
  /**
   * The socket was lost, before the reconnect is scheduled. `code` is the close
   * code, or 0 when this side gave up on the socket (an idle timeout, a failed
   * send). The protocol clears its per-socket state here and decides from the
   * code whether its session can still be resumed.
   */
  onDisconnect?(code: number, reason: string): void;
  /** True for a close the peer will keep refusing — a rejected credential, a refused intent. */
  isFatalClose?(code: number, reason: string): boolean;
  /** Reconnect when no frame arrives for this long. 0 disables the watchdog. */
  idleTimeoutMs?: number;
  backoff?: CommunityRealtimeBackoff;
}

/**
 * The transport half of a realtime source: one WebSocket kept open, with
 * backoff reconnects, an idle watchdog, and listener bookkeeping. Everything
 * platform-specific — handshake, heartbeats, event names — lives in the
 * protocol handler that drives the `SocketHandle`.
 *
 * A transport failure is never thrown at the caller: the socket reports it
 * through its state and retries, so a platform being unreachable degrades the
 * feed instead of failing the process that started it.
 */
export function createReconnectingSocket(options: ReconnectingSocketOptions, logger: CommunityLogger, label: string) {
  const backoff = options.backoff ?? DEFAULT_REALTIME_BACKOFF;
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;
  const emitter = createSignalEmitter((error) =>
    logger.warn({ socket: label, message: `A realtime listener threw: ${describe(error)}` }),
  );

  let socket: WebSocket | null = null;
  let state: CommunityRealtimeState = CommunityRealtimeState.stopped;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let stopped = true;
  /** Guards against a late close event from a socket we already replaced. */
  let generation = 0;

  const setState = (next: CommunityRealtimeState): void => {
    if (state === next) return;
    state = next;
    emitter.emitState(next);
  };

  const clearIdleWatchdog = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const armIdleWatchdog = (): void => {
    if (idleTimeoutMs <= 0) return;
    clearIdleWatchdog();
    idleTimer = setTimeout(() => {
      logger.warn({ socket: label, message: `No frame for ${idleTimeoutMs}ms; reconnecting.` });
      dropAndRetry('idle timeout');
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };

  const teardown = (code: number, reason: string): void => {
    generation += 1;
    clearIdleWatchdog();
    const current = socket;
    socket = null;
    if (!current) return;
    options.onDisconnect?.(code, reason);
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
      current.close(NORMAL_CLOSURE);
    } catch {
      // Already closing or closed; nothing else to release.
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer) return;
    const delay = realtimeReconnectDelay(attempt, backoff);
    attempt += 1;
    setState(CommunityRealtimeState.retrying);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
    reconnectTimer.unref?.();
    logger.debug({ socket: label, message: `Reconnecting in ${delay}ms (attempt ${attempt}).` });
  };

  /** `code` is 0 when this side gave up on the socket rather than the peer closing it. */
  const dropAndRetry = (reason: string, code = 0): void => {
    if (stopped) return;
    logger.debug({ socket: label, message: `Dropping the socket: ${reason}.` });
    teardown(code, reason);
    scheduleReconnect();
  };

  const handle: SocketHandle = {
    send(payload) {
      const current = socket;
      if (!current || current.readyState !== WebSocket.OPEN) return;
      try {
        current.send(payload);
      } catch (error) {
        logger.warn({ socket: label, message: `Send failed: ${describe(error)}` });
        dropAndRetry('send failed');
      }
    },
    markLive() {
      attempt = 0;
      setState(CommunityRealtimeState.live);
    },
    reconnect(reason) {
      dropAndRetry(reason);
    },
  };

  async function connect(): Promise<void> {
    if (stopped) return;
    setState(CommunityRealtimeState.connecting);

    let target: Awaited<ReturnType<ReconnectingSocketOptions['open']>>;
    try {
      target = await options.open();
    } catch (error) {
      // A refused outbound policy or an unresolvable host: worth retrying, the
      // deployment may be mid-rollout, but never worth crashing over.
      logger.warn({ socket: label, message: `Could not resolve the feed target: ${describe(error)}` });
      scheduleReconnect();
      return;
    }
    if (stopped) return;

    const mine = generation;
    let current: WebSocket;
    try {
      current = new WebSocket(target.url, { headers: target.headers, dispatcher: target.dispatcher });
    } catch (error) {
      logger.warn({ socket: label, message: `Could not open the socket: ${describe(error)}` });
      scheduleReconnect();
      return;
    }
    socket = current;

    current.onopen = () => {
      if (mine !== generation) return;
      logger.debug({ socket: label, message: 'Socket open; waiting for the protocol handshake.' });
      armIdleWatchdog();
      options.onOpen?.(handle);
    };

    current.onmessage = (event) => {
      if (mine !== generation) return;
      armIdleWatchdog();
      const payload = toText(event.data);
      // Binary frames mean a compressed or msgpack feed we did not negotiate.
      if (payload === undefined) return;
      try {
        options.onMessage(payload, handle);
      } catch (error) {
        logger.warn({ socket: label, message: `Frame handling failed: ${describe(error)}` });
      }
    };

    // undici raises `error` before `close`; the close carries the actionable code.
    current.onerror = () => undefined;

    current.onclose = (event) => {
      if (mine !== generation) return;
      const reason = typeof event.reason === 'string' ? event.reason : '';
      if (options.isFatalClose?.(event.code, reason) === true) {
        logger.warn({
          socket: label,
          message: `The platform refused the feed (close ${event.code}); it stays down until reconfigured.`,
        });
        teardown(event.code, reason);
        setState(CommunityRealtimeState.fatal);
        return;
      }
      logger.debug({ socket: label, message: `Socket closed (${event.code}).` });
      dropAndRetry(`closed with ${event.code}`, event.code);
    };
  }

  return {
    get state(): CommunityRealtimeState {
      return state;
    },
    start(): void {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      void connect();
    },
    async stop(): Promise<void> {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      teardown(NORMAL_CLOSURE, 'stopped');
      setState(CommunityRealtimeState.stopped);
      emitter.clear();
      await Promise.resolve();
    },
    onSignal: emitter.onSignal,
    onStateChange: emitter.onStateChange,
    emitSignal: emitter.emitSignal,
  };
}

function toText(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  return undefined;
}

/** Error name only: a platform error message can embed a response-body snippet. */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

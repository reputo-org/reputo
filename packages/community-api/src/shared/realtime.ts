/**
 * The platform-push side of the package: instead of asking a platform whether
 * anything changed, each platform tells us. A source normalizes its transport's
 * events into `CommunitySignal`s — "this community changed, go look" — and the
 * consumer re-probes the connection to establish what changed.
 *
 * A signal never carries platform payload: an id, a kind, and the event name
 * that produced it. That keeps the content rule of this package intact even
 * though the transports (a Discord Gateway socket, a Mattermost socket) also
 * carry message events, which the sources drop on the floor.
 */

/** Platform a signal came from. Mirrors `CommunityPlatform` in `@reputo/contracts`. */
export type CommunitySignalPlatform = 'discord' | 'github' | 'mattermost';

/**
 * What kind of change the platform announced. Every kind ends in the same
 * re-probe — the probe is the only thing that decides status and read verdicts
 * — so the kind exists to explain the probe in logs and audits, and to let a
 * consumer prioritize a community it just lost.
 */
export const CommunitySignalKind = {
  /** The community itself changed: its name, its icon, the bot's standing in it. */
  community: 'community',
  /** The selectable resources changed: a channel added, renamed, hidden, or a role re-permissioned. */
  resources: 'resources',
  /** Reputo lost the community outright — the bot was kicked, the App uninstalled or suspended. */
  revoked: 'revoked',
} as const;

export type CommunitySignalKind = (typeof CommunitySignalKind)[keyof typeof CommunitySignalKind];

/** One "go look at this community" notice, as a source emits it. */
export interface CommunitySignal {
  platform: CommunitySignalPlatform;
  /** Platform-side community id — the connection key, not a resource id. */
  externalId: string;
  kind: CommunitySignalKind;
  /** Platform event name that produced the signal, for logs. Never a payload. */
  event: string;
  at: Date;
}

/**
 * Where a source's transport stands. `live` is the only state in which the
 * consumer may stop polling that platform; `fatal` means the credential or
 * configuration is wrong and reconnecting cannot fix it.
 */
export const CommunityRealtimeState = {
  stopped: 'stopped',
  connecting: 'connecting',
  live: 'live',
  /** Disconnected, with a reconnect scheduled. */
  retrying: 'retrying',
  /** Refused for a reason a retry cannot fix; the source stays down until reconfigured. */
  fatal: 'fatal',
} as const;

export type CommunityRealtimeState = (typeof CommunityRealtimeState)[keyof typeof CommunityRealtimeState];

export type CommunitySignalListener = (signal: CommunitySignal) => void;
export type CommunityRealtimeStateListener = (state: CommunityRealtimeState) => void;
export type Unsubscribe = () => void;

/**
 * A long-lived platform feed. `start` never throws for a transport problem —
 * the source reports it through its state and keeps retrying — so a platform
 * being unreachable can never fail application boot.
 */
export interface CommunityRealtimeSource {
  readonly platform: CommunitySignalPlatform;
  /** Identity of what this source follows: the bot for Discord, one team for Mattermost. */
  readonly key: string;
  readonly state: CommunityRealtimeState;
  start(): void;
  stop(): Promise<void>;
  onSignal(listener: CommunitySignalListener): Unsubscribe;
  onStateChange(listener: CommunityRealtimeStateListener): Unsubscribe;
}

/** Backoff for a reconnecting feed. Jitter keeps replicas from retrying in lockstep. */
export interface CommunityRealtimeBackoff {
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_REALTIME_BACKOFF: CommunityRealtimeBackoff = {
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

/** Full jitter: a delay anywhere in [0, capped exponential]. */
export function realtimeReconnectDelay(attempt: number, backoff: CommunityRealtimeBackoff): number {
  const ceiling = Math.min(backoff.maxDelayMs, backoff.baseDelayMs * 2 ** Math.max(0, attempt));
  return Math.round(Math.random() * ceiling);
}

/**
 * Listener bookkeeping every source needs, kept in one place so a source file
 * is only its platform's protocol. A throwing listener is isolated: one broken
 * consumer must not tear down the feed for the others.
 */
export function createSignalEmitter(onListenerError: (error: unknown) => void) {
  const signalListeners = new Set<CommunitySignalListener>();
  const stateListeners = new Set<CommunityRealtimeStateListener>();

  return {
    onSignal(listener: CommunitySignalListener): Unsubscribe {
      signalListeners.add(listener);
      return () => signalListeners.delete(listener);
    },
    onStateChange(listener: CommunityRealtimeStateListener): Unsubscribe {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    emitSignal(signal: CommunitySignal): void {
      for (const listener of signalListeners) {
        try {
          listener(signal);
        } catch (error) {
          onListenerError(error);
        }
      }
    },
    emitState(state: CommunityRealtimeState): void {
      for (const listener of stateListeners) {
        try {
          listener(state);
        } catch (error) {
          onListenerError(error);
        }
      }
    },
    clear(): void {
      signalListeners.clear();
      stateListeners.clear();
    },
  };
}

import { describe, expect, it, vi } from 'vitest';
import {
  type CommunitySignal,
  createSignalEmitter,
  DEFAULT_REALTIME_BACKOFF,
  realtimeReconnectDelay,
} from '../../../src/shared/realtime.js';

const signal = (): CommunitySignal => ({
  platform: 'discord',
  externalId: 'guild-1',
  kind: 'resources',
  event: 'CHANNEL_UPDATE',
  at: new Date(),
});

describe('realtimeReconnectDelay', () => {
  it('grows the ceiling exponentially and never exceeds the cap', () => {
    const attempts = [0, 1, 2, 3, 10, 50];
    const samples = attempts.flatMap((attempt) =>
      Array.from({ length: 50 }, () => realtimeReconnectDelay(attempt, DEFAULT_REALTIME_BACKOFF)),
    );

    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(DEFAULT_REALTIME_BACKOFF.maxDelayMs);
  });

  it('jitters, so replicas do not retry in lockstep', () => {
    const backoff = { baseDelayMs: 1_000, maxDelayMs: 60_000 };
    const samples = new Set(Array.from({ length: 40 }, () => realtimeReconnectDelay(5, backoff)));

    expect(samples.size).toBeGreaterThan(1);
  });

  it('caps the very first attempt at the base delay', () => {
    const backoff = { baseDelayMs: 500, maxDelayMs: 60_000 };

    for (let i = 0; i < 50; i++) {
      expect(realtimeReconnectDelay(0, backoff)).toBeLessThanOrEqual(500);
    }
  });
});

describe('createSignalEmitter', () => {
  it('fans a signal out to every listener and stops on unsubscribe', () => {
    const emitter = createSignalEmitter(vi.fn());
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = emitter.onSignal(first);
    emitter.onSignal(second);

    emitter.emitSignal(signal());
    unsubscribe();
    emitter.emitSignal(signal());

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing listener, so one broken consumer cannot take the feed down', () => {
    const onListenerError = vi.fn();
    const emitter = createSignalEmitter(onListenerError);
    const healthy = vi.fn();
    emitter.onSignal(() => {
      throw new Error('consumer exploded');
    });
    emitter.onSignal(healthy);

    expect(() => emitter.emitSignal(signal())).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(onListenerError).toHaveBeenCalledTimes(1);
  });

  it('reports state changes on their own channel', () => {
    const emitter = createSignalEmitter(vi.fn());
    const states: string[] = [];
    emitter.onStateChange((state) => states.push(state));

    emitter.emitState('connecting');
    emitter.emitState('live');

    expect(states).toEqual(['connecting', 'live']);
  });

  it('drops every listener on clear, so a stopped source cannot emit again', () => {
    const emitter = createSignalEmitter(vi.fn());
    const listener = vi.fn();
    emitter.onSignal(listener);

    emitter.clear();
    emitter.emitSignal(signal());

    expect(listener).not.toHaveBeenCalled();
  });
});

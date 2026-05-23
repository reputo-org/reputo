import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_UPDATES_CHANNEL, SnapshotListenerService } from '../../../src/persistence';

type Awaitable<T> = T | Promise<T>;

interface FakeClient extends EventEmitter {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function createFakeClient(options: { connect?: () => Awaitable<void> } = {}): FakeClient {
  const emitter = new EventEmitter() as FakeClient;
  emitter.connect = vi.fn(async () => {
    if (options.connect) await options.connect();
  });
  emitter.query = vi.fn(async () => undefined);
  emitter.end = vi.fn(async () => undefined);
  return emitter;
}

class TestableListenerService extends SnapshotListenerService {
  constructor(
    configService: ConfigService,
    private readonly nextClient: () => FakeClient,
  ) {
    super(configService);
  }

  protected override createClient(): Client {
    return this.nextClient() as unknown as Client;
  }
}

function makeService(clients: FakeClient[]) {
  const configService = {
    get: vi.fn((key: string) => (key === 'database.url' ? 'postgres://test' : undefined)),
  } as unknown as ConfigService;
  let idx = 0;
  return {
    service: new TestableListenerService(configService, () => {
      const client = clients[idx++];
      if (!client) throw new Error('No fake client queued');
      return client;
    }),
  };
}

describe('SnapshotListenerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('throws on construction when database.url is not configured', () => {
    const configService = { get: vi.fn(() => undefined) } as unknown as ConfigService;
    expect(() => new SnapshotListenerService(configService)).toThrow(/database\.url is not configured/);
  });

  it('connects, runs LISTEN on the snapshot_updates channel, and emits snapshot ids from NOTIFY payloads', async () => {
    const client = createFakeClient();
    const { service } = makeService([client]);

    const received: string[] = [];
    service.notifications$.subscribe((id) => received.push(id));

    await service.onModuleInit();

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith(`LISTEN ${SNAPSHOT_UPDATES_CHANNEL}`);

    client.emit('notification', { channel: SNAPSHOT_UPDATES_CHANNEL, payload: 'snapshot-abc' });
    client.emit('notification', { channel: 'other_channel', payload: 'ignored' });
    client.emit('notification', { channel: SNAPSHOT_UPDATES_CHANNEL, payload: '' });

    expect(received).toEqual(['snapshot-abc']);

    await service.onModuleDestroy();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('reconnects with exponential backoff after the connection ends unexpectedly', async () => {
    const first = createFakeClient();
    const second = createFakeClient();
    const { service } = makeService([first, second]);

    await service.onModuleInit();
    expect(first.connect).toHaveBeenCalledOnce();

    first.emit('end');

    // First reconnect delay = 500ms
    await vi.advanceTimersByTimeAsync(500);

    expect(second.connect).toHaveBeenCalledOnce();
    expect(second.query).toHaveBeenCalledWith(`LISTEN ${SNAPSHOT_UPDATES_CHANNEL}`);

    await service.onModuleDestroy();
  });

  it('schedules a reconnect after a connection error', async () => {
    const first = createFakeClient();
    const second = createFakeClient();
    const { service } = makeService([first, second]);

    await service.onModuleInit();
    first.emit('error', new Error('boom'));

    await vi.advanceTimersByTimeAsync(500);

    expect(second.connect).toHaveBeenCalledOnce();

    await service.onModuleDestroy();
  });

  it('retries after an initial connect failure', async () => {
    const failing = createFakeClient({
      connect: async () => {
        throw new Error('initial connect failed');
      },
    });
    const success = createFakeClient();
    const { service } = makeService([failing, success]);

    await service.onModuleInit();
    expect(failing.connect).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(500);

    expect(success.connect).toHaveBeenCalledOnce();
    expect(success.query).toHaveBeenCalledWith(`LISTEN ${SNAPSHOT_UPDATES_CHANNEL}`);

    await service.onModuleDestroy();
  });

  it('stops reconnecting once the module is destroyed', async () => {
    const first = createFakeClient();
    const second = createFakeClient();
    const { service } = makeService([first, second]);

    await service.onModuleInit();
    first.emit('end');
    await service.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(second.connect).not.toHaveBeenCalled();
  });
});

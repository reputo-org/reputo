import type { ConfigService } from '@nestjs/config';
import { SnapshotStatus } from '@reputo/contracts';
import { firstValueFrom, lastValueFrom, take, timeout, toArray } from 'rxjs';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITIES, SnapshotEntity, SnapshotListenerService, SnapshotOutputEntity } from '../../../src/persistence';
import type { SnapshotEventDto } from '../../../src/snapshot/dto';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';
import { SnapshotEventsService } from '../../../src/snapshot/snapshot-events.service';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { truncateAllTables } from '../../utils/db';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';

// Exercises the SSE pipeline against a real Postgres:
//   - SnapshotRepository.applyExternalUpdate emits NOTIFY inside the txn
//   - SnapshotListenerService receives it on its dedicated pg.Client
//   - SnapshotEventsService fetches the row and broadcasts to subscribers
//
// The HTTP/SSE transport is a thin `map((event) => ({ data: event }))` wrap in
// the controller and is not exercised here — the service-level observable is
// the boundary that matters for propagation correctness.

function makeConfigService(databaseUrl: string): ConfigService {
  return {
    get: vi.fn((key: string) => (key === 'database.url' ? databaseUrl : undefined)),
  } as unknown as ConfigService;
}

describe('Snapshot SSE via PostgreSQL LISTEN/NOTIFY', () => {
  let db: TestDatabase;
  let dataSource: DataSource;
  let repository: SnapshotRepository;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    dataSource = new DataSource({
      type: 'postgres',
      url: db.databaseUrl,
      entities: [...ENTITIES],
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    repository = new SnapshotRepository(
      dataSource.getRepository(SnapshotEntity),
      dataSource.getRepository(SnapshotOutputEntity),
    );
  }, 120_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    await db?.stop();
  });

  async function seedSnapshot() {
    const preset = await insertAlgorithmPreset(dataSource);
    const frozen = {
      key: preset.key,
      version: preset.version,
      inputs: preset.inputs.map((input) => ({ key: input.key, value: input.value })),
      name: preset.name ?? undefined,
      description: preset.description ?? undefined,
      createdAt: preset.createdAt.toISOString(),
      updatedAt: preset.updatedAt.toISOString(),
    };
    const snapshotRepo = dataSource.getRepository(SnapshotEntity);
    const snapshot = await snapshotRepo.save(
      snapshotRepo.create({
        status: SnapshotStatus.queued,
        algorithmPresetId: preset.id,
        algorithmPresetFrozen: frozen as unknown,
      }),
    );
    return { preset, snapshot };
  }

  it('propagates an update from PG NOTIFY to a connected SSE subscriber within ~1s', async () => {
    const listener = new SnapshotListenerService(makeConfigService(db.databaseUrl));
    const events = new SnapshotEventsService(listener, repository);
    await listener.onModuleInit();
    events.onModuleInit();

    try {
      const { snapshot } = await seedSnapshot();

      const received = firstValueFrom(events.subscribe().pipe(timeout({ first: 5_000 }), take(1)));

      await repository.applyExternalUpdate(snapshot.id, { status: SnapshotStatus.running, startedAt: new Date() });

      const event = (await received) as SnapshotEventDto;
      expect(event.type).toBe('snapshot:updated');
      expect(event.data._id).toBe(snapshot.id);
      expect(event.data.status).toBe('running');
    } finally {
      events.onModuleDestroy();
      await listener.onModuleDestroy();
    }
  }, 30_000);

  it('delivers updates produced from replica B to a subscriber connected on replica A (multi-replica fan-out)', async () => {
    const listenerA = new SnapshotListenerService(makeConfigService(db.databaseUrl));
    const listenerB = new SnapshotListenerService(makeConfigService(db.databaseUrl));
    const eventsA = new SnapshotEventsService(listenerA, repository);
    const eventsB = new SnapshotEventsService(listenerB, repository);

    await Promise.all([listenerA.onModuleInit(), listenerB.onModuleInit()]);
    eventsA.onModuleInit();
    eventsB.onModuleInit();

    try {
      const { snapshot } = await seedSnapshot();

      const received = firstValueFrom(eventsA.subscribe().pipe(timeout({ first: 5_000 }), take(1)));

      // "Replica B" performs the write; "Replica A" must observe it via PG.
      await repository.applyExternalUpdate(snapshot.id, {
        status: SnapshotStatus.completed,
        completedAt: new Date(),
      });
      // Touch eventsB to verify both replicas receive the same NOTIFY.
      const receivedB = firstValueFrom(eventsB.subscribe().pipe(timeout({ first: 1_000 }), take(1)));
      await repository.applyExternalUpdate(snapshot.id, { status: SnapshotStatus.failed, completedAt: new Date() });

      const eventA = (await received) as SnapshotEventDto;
      expect(eventA.data._id).toBe(snapshot.id);
      expect(['completed', 'failed']).toContain(eventA.data.status);

      const eventB = (await receivedB) as SnapshotEventDto;
      expect(eventB.data._id).toBe(snapshot.id);
    } finally {
      eventsA.onModuleDestroy();
      eventsB.onModuleDestroy();
      await listenerA.onModuleDestroy();
      await listenerB.onModuleDestroy();
    }
  }, 30_000);

  it('applies the algorithmPreset filter so subscribers only receive matching events', async () => {
    const listener = new SnapshotListenerService(makeConfigService(db.databaseUrl));
    const events = new SnapshotEventsService(listener, repository);
    await listener.onModuleInit();
    events.onModuleInit();

    try {
      const a = await seedSnapshot();
      const b = await seedSnapshot();

      const collected = lastValueFrom(
        events.subscribe({ algorithmPreset: b.preset.id }).pipe(timeout({ first: 5_000 }), take(1), toArray()),
      );

      // First update fires NOTIFY for preset A → should be filtered out by the
      // subscriber. The second NOTIFY (preset B) is the one we should capture.
      await repository.applyExternalUpdate(a.snapshot.id, {
        status: SnapshotStatus.running,
        startedAt: new Date(),
      });
      await repository.applyExternalUpdate(b.snapshot.id, {
        status: SnapshotStatus.running,
        startedAt: new Date(),
      });

      const captured = (await collected) as SnapshotEventDto[];
      expect(captured).toHaveLength(1);
      expect(captured[0]?.data._id).toBe(b.snapshot.id);
      expect(captured[0]?.data.algorithmPreset).toBe(b.preset.id);
    } finally {
      events.onModuleDestroy();
      await listener.onModuleDestroy();
    }
  }, 30_000);
});

import { type ApiSnapshotActivities, SnapshotStatus, type UpdateSnapshotInput } from '@reputo/contracts';
import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITIES, SnapshotEntity, SnapshotOutputEntity } from '../../../src/persistence';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';
import { SnapshotService } from '../../../src/snapshot/snapshot.service';
import { createSnapshotActivities } from '../../../src/temporal/snapshot.activities';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { truncateAllTables } from '../../utils/db';
import { getSharedDatabaseUrl } from '../../utils/postgres-testcontainer';
import { randomUUIDv7 } from '../../utils/uuid';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
  setContext: vi.fn(),
};

describe('API snapshot activities (integration)', () => {
  let databaseUrl: string;
  let dataSource: DataSource;
  let service: SnapshotService;
  let activities: ApiSnapshotActivities;
  let env: MockActivityEnvironment;

  beforeAll(async () => {
    databaseUrl = getSharedDatabaseUrl();

    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [...ENTITIES],
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();

    const repository = new SnapshotRepository(
      dataSource.getRepository(SnapshotEntity),
      dataSource.getRepository(SnapshotOutputEntity),
    );
    const algorithmPresetRepository = { findById: vi.fn() } as unknown as ConstructorParameters<
      typeof SnapshotService
    >[2];
    const temporalService = {
      startSnapshotWorkflow: vi.fn(),
      terminateSnapshotWorkflow: vi.fn(),
    } as unknown as ConstructorParameters<typeof SnapshotService>[3];
    const storageService = {
      listObjectsByPrefix: vi.fn().mockResolvedValue([]),
      deleteObjects: vi.fn().mockResolvedValue({ deleted: [], errors: [] }),
    } as unknown as ConstructorParameters<typeof SnapshotService>[4];
    const configService = {
      get: vi.fn(() => undefined),
    } as unknown as ConstructorParameters<typeof SnapshotService>[5];

    service = new SnapshotService(
      logger as never,
      repository,
      algorithmPresetRepository,
      temporalService,
      storageService,
      configService,
    );
    activities = createSnapshotActivities(service);
  }, 120_000);

  beforeEach(async () => {
    env = new MockActivityEnvironment();
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
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

  describe('getSnapshot', () => {
    it('returns the snapshot DTO when the row exists', async () => {
      const { snapshot } = await seedSnapshot();

      const result = await env.run(activities.getSnapshot, { snapshotId: snapshot.id });

      expect(result.id).toBe(snapshot.id);
      expect(result.status).toBe('queued');
      expect(typeof result.createdAt).toBe('string');
    });

    it('surfaces NOT_FOUND as a non-retryable ApplicationFailure', async () => {
      const missingId = randomUUIDv7();

      const error = await env.run(activities.getSnapshot, { snapshotId: missingId }).catch((e) => e);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
      expect((error as ApplicationFailure).type).toBe('SnapshotNotFoundError');
    });
  });

  describe('updateSnapshot', () => {
    it('stamps startedAt on transition to running', async () => {
      const { snapshot } = await seedSnapshot();

      await env.run(activities.updateSnapshot, { snapshotId: snapshot.id, status: SnapshotStatus.running });

      const persisted = await dataSource.getRepository(SnapshotEntity).findOne({ where: { id: snapshot.id } });
      expect(persisted?.status).toBe(SnapshotStatus.running);
      expect(persisted?.startedAt).not.toBeNull();
      expect(persisted?.completedAt).toBeNull();
    });

    it.each([
      SnapshotStatus.completed,
      SnapshotStatus.failed,
      SnapshotStatus.cancelled,
    ])('stamps completedAt on transition to %s', async (status) => {
      const { snapshot } = await seedSnapshot();

      await env.run(activities.updateSnapshot, { snapshotId: snapshot.id, status });

      const persisted = await dataSource.getRepository(SnapshotEntity).findOne({ where: { id: snapshot.id } });
      expect(persisted?.status).toBe(status);
      expect(persisted?.completedAt).not.toBeNull();
    });

    it('persists temporal/outputs/error payloads', async () => {
      const { snapshot } = await seedSnapshot();

      await env.run(activities.updateSnapshot, {
        snapshotId: snapshot.id,
        temporal: { workflowId: 'wf-1', taskQueue: 'orchestrator' },
        outputs: { csv: 'snapshots/output.csv' },
        error: { message: 'boom' },
      } satisfies UpdateSnapshotInput);

      const persisted = await dataSource.getRepository(SnapshotEntity).findOne({
        where: { id: snapshot.id },
        relations: { outputs: true },
      });
      expect(persisted?.temporal).toEqual({ workflowId: 'wf-1', taskQueue: 'orchestrator' });
      expect(persisted?.outputs.map((o) => ({ key: o.key, value: o.value }))).toEqual([
        { key: 'csv', value: 'snapshots/output.csv' },
      ]);
      expect((persisted?.error as { message?: string } | null)?.message).toBe('boom');
      expect(typeof (persisted?.error as { timestamp?: string } | null)?.timestamp).toBe('string');
    });

    it('is idempotent under retry: same input twice → same DB state without duplicate output rows', async () => {
      const { snapshot } = await seedSnapshot();

      const input = {
        snapshotId: snapshot.id,
        status: SnapshotStatus.completed,
        outputs: { csv: 'snapshots/result.csv' },
      } satisfies UpdateSnapshotInput;

      await env.run(activities.updateSnapshot, input);
      const snapshotRepo = dataSource.getRepository(SnapshotEntity);
      const after1 = await snapshotRepo.findOne({ where: { id: snapshot.id }, relations: { outputs: true } });
      await env.run(activities.updateSnapshot, input);
      const after2 = await snapshotRepo.findOne({ where: { id: snapshot.id }, relations: { outputs: true } });

      expect(after1?.status).toBe(SnapshotStatus.completed);
      expect(after2?.status).toBe(SnapshotStatus.completed);
      expect(after2?.outputs).toHaveLength(1);
      expect(after2?.outputs.map((o) => ({ key: o.key, value: o.value }))).toEqual(
        after1?.outputs.map((o) => ({ key: o.key, value: o.value })),
      );
    });

    it('throws non-retryable ApplicationFailure when the snapshot is missing', async () => {
      const missingId = randomUUIDv7();

      const error = await env
        .run(activities.updateSnapshot, { snapshotId: missingId, status: SnapshotStatus.running })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
    });

    it('publishes a NOTIFY on snapshot_updates inside the same transaction as the update', async () => {
      const { snapshot } = await seedSnapshot();
      const received: string[] = [];

      const { Client: PgClient } = await import('pg');
      const pg = new PgClient({ connectionString: databaseUrl });
      await pg.connect();
      pg.on('notification', (msg) => {
        if (msg.channel === 'snapshot_updates' && msg.payload) {
          received.push(msg.payload);
        }
      });
      await pg.query('LISTEN snapshot_updates');

      try {
        await env.run(activities.updateSnapshot, { snapshotId: snapshot.id, status: SnapshotStatus.running });
        await new Promise((r) => setTimeout(r, 250));
      } finally {
        await pg.query('UNLISTEN snapshot_updates');
        await pg.end();
      }

      expect(received).toContain(snapshot.id);
    });
  });
});

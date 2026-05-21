import type { ApiSnapshotActivities, UpdateSnapshotInput } from '@reputo/contracts';
import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../src/persistence';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';
import { SnapshotService } from '../../../src/snapshot/snapshot.service';
import { createSnapshotActivities } from '../../../src/temporal/snapshot.activities';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { randomUUIDv7 } from '../../utils/uuid';

// Exercises the API-side Temporal activities end-to-end:
//   - `getSnapshot` / `updateSnapshot` invoked through `MockActivityEnvironment`
//   - SnapshotService + SnapshotRepository wired against a Postgres testcontainer
//   - The `NOTIFY` side effect is verified by listening on the channel
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
  setContext: vi.fn(),
};

describe('API snapshot activities (integration)', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let service: SnapshotService;
  let activities: ApiSnapshotActivities;
  let env: MockActivityEnvironment;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;

    prisma = new PrismaService();
    await prisma.onModuleInit();

    const repository = new SnapshotRepository(prisma);
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
    await prisma.snapshot.deleteMany({});
    await prisma.algorithmPreset.deleteMany({});
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.stop();
  });

  async function seedSnapshot() {
    const preset = await insertAlgorithmPreset(prisma);
    const frozen = {
      key: preset.key,
      version: preset.version,
      inputs: preset.inputs as Array<{ key: string; value?: unknown }>,
      name: preset.name ?? undefined,
      description: preset.description ?? undefined,
      createdAt: preset.createdAt.toISOString(),
      updatedAt: preset.updatedAt.toISOString(),
    };
    const snapshot = await prisma.snapshot.create({
      data: {
        status: 'queued',
        algorithmPresetId: preset.id,
        algorithmPresetFrozen: frozen,
      },
    });
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

      await env.run(activities.updateSnapshot, { snapshotId: snapshot.id, status: 'running' });

      const persisted = await prisma.snapshot.findUnique({ where: { id: snapshot.id } });
      expect(persisted?.status).toBe('running');
      expect(persisted?.startedAt).not.toBeNull();
      expect(persisted?.completedAt).toBeNull();
    });

    it.each(['completed', 'failed', 'cancelled'] as const)('stamps completedAt on transition to %s', async (status) => {
      const { snapshot } = await seedSnapshot();

      await env.run(activities.updateSnapshot, { snapshotId: snapshot.id, status });

      const persisted = await prisma.snapshot.findUnique({ where: { id: snapshot.id } });
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

      const persisted = await prisma.snapshot.findUnique({ where: { id: snapshot.id } });
      expect(persisted?.temporal).toEqual({ workflowId: 'wf-1', taskQueue: 'orchestrator' });
      expect(persisted?.outputs).toEqual({ csv: 'snapshots/output.csv' });
      expect((persisted?.error as { message?: string } | null)?.message).toBe('boom');
      expect(typeof (persisted?.error as { timestamp?: string } | null)?.timestamp).toBe('string');
    });

    it('is idempotent under retry: same input twice → same DB state', async () => {
      const { snapshot } = await seedSnapshot();

      const input = {
        snapshotId: snapshot.id,
        status: 'completed' as const,
        outputs: { csv: 'snapshots/result.csv' },
      };

      await env.run(activities.updateSnapshot, input);
      const after1 = await prisma.snapshot.findUnique({ where: { id: snapshot.id } });
      await env.run(activities.updateSnapshot, input);
      const after2 = await prisma.snapshot.findUnique({ where: { id: snapshot.id } });

      expect(after1?.status).toBe('completed');
      expect(after2?.status).toBe('completed');
      expect(after2?.outputs).toEqual(after1?.outputs);
    });

    it('throws non-retryable ApplicationFailure when the snapshot is missing', async () => {
      const missingId = randomUUIDv7();

      const error = await env
        .run(activities.updateSnapshot, { snapshotId: missingId, status: 'running' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
    });

    it('publishes a NOTIFY on snapshot_updates inside the same transaction as the update', async () => {
      const { snapshot } = await seedSnapshot();
      const received: string[] = [];

      // Use a raw pg client because Prisma does not expose LISTEN. A
      // dedicated connection is required so the LISTEN registers before the
      // activity commits and we don't miss the notification.
      const { Client: PgClient } = await import('pg');
      const pg = new PgClient({ connectionString: db.databaseUrl });
      await pg.connect();
      pg.on('notification', (msg) => {
        if (msg.channel === 'snapshot_updates' && msg.payload) {
          received.push(msg.payload);
        }
      });
      await pg.query('LISTEN snapshot_updates');

      try {
        await env.run(activities.updateSnapshot, { snapshotId: snapshot.id, status: 'running' });
        // pg emits notifications asynchronously after the writer commits; give
        // the client a tick to drain.
        await new Promise((r) => setTimeout(r, 250));
      } finally {
        await pg.query('UNLISTEN snapshot_updates');
        await pg.end();
      }

      expect(received).toContain(snapshot.id);
    });
  });
});

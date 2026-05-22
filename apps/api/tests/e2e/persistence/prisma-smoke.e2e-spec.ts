import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../src/persistence';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';

describe('Prisma bootstrap smoke', () => {
  let db: TestDatabase;
  let prismaService: PrismaService;

  beforeAll(async () => {
    db = await startTestDatabase();
    // PrismaClient reads `env("DATABASE_URL")` from schema.prisma at
    // construction time, so the testcontainer URL must be in process.env
    // before we instantiate the service.
    process.env.DATABASE_URL = db.databaseUrl;
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await db?.stop();
  });

  it('exposes the PrismaClient surface used by repositories', () => {
    expect(typeof prismaService.$queryRaw).toBe('function');
    expect(typeof prismaService.$executeRaw).toBe('function');
    expect(typeof prismaService.$connect).toBe('function');
    expect(typeof prismaService.$disconnect).toBe('function');
  });

  it('runs $queryRaw against the testcontainer', async () => {
    const rows = await prismaService.$queryRaw<{ one: number }[]>`SELECT 1 as one`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].one)).toBe(1);
  });

  // Pins the snake_case DB-layer name produced by `@@map`. If a future schema
  // edit drops the @@map (or pluralization) for `Snapshot`, this fails fast.
  it('has the canonical snake_case `snapshots` table in PG', async () => {
    const rows = await prismaService.$queryRaw<
      { exists: boolean }[]
    >`SELECT to_regclass('public.snapshots') IS NOT NULL AS exists`;
    expect(rows[0]?.exists).toBe(true);
  });
});

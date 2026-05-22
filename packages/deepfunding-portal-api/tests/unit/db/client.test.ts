import { afterEach, describe, expect, it } from 'vitest';
import { closeDbInstance, createDb } from '../../../src/db/client.js';
import type { DeepFundingPortalDb } from '../../../src/shared/types/db.js';
import { cleanupTestDb, tableExists } from '../../utils/db-helpers.js';

describe('Database Client', () => {
  let db: DeepFundingPortalDb | null = null;

  afterEach(async () => {
    if (db) {
      await cleanupTestDb(db);
      db = null;
    }
  });

  describe('createDb', () => {
    it('should create an initialized data source', async () => {
      db = await createDb({ path: ':memory:' });

      expect(db).toBeDefined();
      expect(db.dataSource).toBeDefined();
      expect(db.dataSource.isInitialized).toBe(true);
    });

    it('should initialize database with schema via migrations', async () => {
      db = await createDb({ path: ':memory:' });

      expect(await tableExists(db, 'rounds')).toBe(true);
      expect(await tableExists(db, 'pools')).toBe(true);
      expect(await tableExists(db, 'proposals')).toBe(true);
      expect(await tableExists(db, 'users')).toBe(true);
      expect(await tableExists(db, 'milestones')).toBe(true);
      expect(await tableExists(db, 'reviews')).toBe(true);
      expect(await tableExists(db, 'comments')).toBe(true);
      expect(await tableExists(db, 'comment_votes')).toBe(true);
    });

    it('should return independent instances', async () => {
      const db1 = await createDb({ path: ':memory:' });
      const db2 = await createDb({ path: ':memory:' });

      expect(db2).toBeDefined();
      expect(db2).not.toBe(db1);
      await closeDbInstance(db1);
      await closeDbInstance(db2);
      db = null;
    });
  });

  describe('closeDbInstance', () => {
    it('should destroy the underlying data source', async () => {
      db = await createDb({ path: ':memory:' });
      const localDb = db;

      await closeDbInstance(localDb);

      expect(localDb.dataSource.isInitialized).toBe(false);
      db = null;
    });

    it('should be safe to call when the data source is already destroyed', async () => {
      db = await createDb({ path: ':memory:' });
      const localDb = db;

      await closeDbInstance(localDb);
      await closeDbInstance(localDb);

      expect(localDb.dataSource.isInitialized).toBe(false);
      db = null;
    });
  });
});

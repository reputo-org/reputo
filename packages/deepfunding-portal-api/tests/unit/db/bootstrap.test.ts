import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeepFundingPortalDb } from '../../../src/db/client.js';
import {
  cleanupTestDb,
  createTestDb,
  getColumnInfo,
  getIndexNames,
  getTableNames,
  tableExists,
} from '../../utils/db-helpers.js';

describe('Database Schema (TypeORM init migration)', () => {
  let db: DeepFundingPortalDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('init migration', () => {
    it('should create all required tables', async () => {
      const tableNames = await getTableNames(db);
      const expectedTables = [
        'rounds',
        'pools',
        'proposals',
        'users',
        'milestones',
        'reviews',
        'comments',
        'comment_votes',
        'meta',
      ];

      for (const tableName of expectedTables) {
        expect(await tableExists(db, tableName)).toBe(true);
        expect(tableNames).toContain(tableName);
      }
    });

    it('should create rounds table with correct structure', async () => {
      expect(await tableExists(db, 'rounds')).toBe(true);

      const columnNames = (await getColumnInfo(db, 'rounds')).map((col) => col.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('slug');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('pool_ids');
      expect(columnNames).toContain('raw_json');
    });

    it('should create pools table with correct structure', async () => {
      expect(await tableExists(db, 'pools')).toBe(true);

      const columnNames = (await getColumnInfo(db, 'pools')).map((col) => col.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('slug');
      expect(columnNames).toContain('max_funding_amount');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('raw_json');
    });

    it('should create proposals table with correct structure', async () => {
      expect(await tableExists(db, 'proposals')).toBe(true);

      const columnNames = (await getColumnInfo(db, 'proposals')).map((col) => col.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('round_id');
      expect(columnNames).toContain('pool_id');
      expect(columnNames).toContain('proposer_id');
      expect(columnNames).toContain('title');
      expect(columnNames).toContain('content');
      expect(columnNames).toContain('raw_json');
    });

    it('should create users table with correct structure', async () => {
      expect(await tableExists(db, 'users')).toBe(true);

      const columnNames = (await getColumnInfo(db, 'users')).map((col) => col.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('collection_id');
      expect(columnNames).toContain('user_name');
      expect(columnNames).toContain('email');
      expect(columnNames).toContain('total_proposals');
      expect(columnNames).toContain('raw_json');
    });

    it('should create milestones table with autoincrement id', async () => {
      expect(await tableExists(db, 'milestones')).toBe(true);

      const idColumn = (await getColumnInfo(db, 'milestones')).find((col) => col.name === 'id');
      expect(idColumn).toBeDefined();
    });

    it('should create reviews table with autoincrement review_id', async () => {
      expect(await tableExists(db, 'reviews')).toBe(true);

      const columnNames = (await getColumnInfo(db, 'reviews')).map((col) => col.name);
      expect(columnNames).toContain('review_id');
      expect(columnNames).toContain('proposal_id');
      expect(columnNames).toContain('reviewer_id');
      expect(columnNames).toContain('review_type');
    });

    it('should create comments table with correct structure', async () => {
      expect(await tableExists(db, 'comments')).toBe(true);

      const columnNames = (await getColumnInfo(db, 'comments')).map((col) => col.name);
      expect(columnNames).toContain('comment_id');
      expect(columnNames).toContain('parent_id');
      expect(columnNames).toContain('is_reply');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('proposal_id');
      expect(columnNames).toContain('content');
    });

    it('should create comment_votes table with composite primary key', async () => {
      expect(await tableExists(db, 'comment_votes')).toBe(true);

      const columns = await getColumnInfo(db, 'comment_votes');
      const columnNames = columns.map((col) => col.name);
      expect(columnNames).toContain('voter_id');
      expect(columnNames).toContain('comment_id');
      expect(columnNames).toContain('vote_type');

      const primaryKeyColumns = columns.filter((col) => col.pk > 0).map((col) => col.name);
      expect(primaryKeyColumns.sort()).toEqual(['comment_id', 'voter_id']);
    });

    it('should create the expected indexes', async () => {
      const indexNames = await getIndexNames(db, 'idx_%');
      expect(indexNames.length).toBeGreaterThan(0);
      expect(indexNames).toContain('idx_reviews_proposal_id');
      expect(indexNames).toContain('idx_reviews_reviewer_id');
      expect(indexNames).toContain('idx_comments_proposal_id');
      expect(indexNames).toContain('idx_proposals_round_id');
      expect(indexNames).toContain('idx_proposals_pool_id');
      expect(indexNames).toContain('idx_comment_votes_comment_id');
    });
  });
});

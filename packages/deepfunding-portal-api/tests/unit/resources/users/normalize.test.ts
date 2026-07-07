import { describe, expect, it } from 'vitest';
import { normalizeUserToRecord } from '../../../../src/resources/users/normalize.js';
import { createMockUser } from '../../../utils/mock-helpers.js';

describe('User Normalization', () => {
  describe('normalizeUserToRecord', () => {
    it('should transform API response to DB record format', () => {
      const user = createMockUser({
        id: 1,
        collection_id: 'test-collection',
        user_name: 'testuser',
        email: 'test@example.com',
        total_proposals: 10,
      });

      const result = normalizeUserToRecord(user);

      expect(result.id).toBe(1);
      expect(result.collectionId).toBe('test-collection');
      expect(result.userName).toBe('testuser');
      expect(result.email).toBe('test@example.com');
      expect(result.totalProposals).toBe(10);
      expect(result.rawJson).toBe(JSON.stringify(user));
    });

    it('should map the did field', () => {
      expect(normalizeUserToRecord(createMockUser({ did: 'did:plc:def456def456def456def456' })).did).toBe(
        'did:plc:def456def456def456def456',
      );
    });

    it('should prefix a bare portal did with did:plc:', () => {
      expect(normalizeUserToRecord(createMockUser({ did: 'def456def456def456def456' })).did).toBe(
        'did:plc:def456def456def456def456',
      );
    });

    it('should leave an already-prefixed did unchanged (idempotent)', () => {
      expect(normalizeUserToRecord(createMockUser({ did: 'did:sub:abc123abc123abc123abc123' })).did).toBe(
        'did:sub:abc123abc123abc123abc123',
      );
    });

    it('should coerce a missing or blank did to an empty string', () => {
      expect(normalizeUserToRecord(createMockUser({ did: '' })).did).toBe('');
      expect(normalizeUserToRecord(createMockUser({ did: undefined as unknown as string })).did).toBe('');
    });

    it('should serialize raw JSON correctly', () => {
      const user = createMockUser({
        id: 42,
        user_name: 'complexuser',
      });

      const result = normalizeUserToRecord(user);
      const parsed = JSON.parse(result.rawJson);

      expect(parsed.id).toBe(42);
      expect(parsed.user_name).toBe('complexuser');
    });
  });
});

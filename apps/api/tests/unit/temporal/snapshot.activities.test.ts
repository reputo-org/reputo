import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityService } from '../../../src/community/community.service';
import type { CommunityConnectionRepository } from '../../../src/community/community-connection.repository';
import type { SnapshotService } from '../../../src/snapshot/snapshot.service';
import { createSnapshotActivities, toSnapshotDto } from '../../../src/temporal/snapshot.activities';

const PRESET_ID = '01940000-0000-7000-8000-000000000000';
const SNAPSHOT_ID = '01940000-0000-7000-8000-000000000001';
const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: SNAPSHOT_ID,
    status: 'queued',
    algorithmPreset: PRESET_ID,
    algorithmPresetFrozen: {
      key: 'voting_engagement',
      version: '1.0.0',
      inputs: [{ key: 'votes', value: 'uploads/votes.csv' }],
      name: 'Test',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('snapshot.activities factory', () => {
  let env: MockActivityEnvironment;
  let snapshotService: {
    findByIdOrNull: ReturnType<typeof vi.fn>;
    applyExternalUpdate: ReturnType<typeof vi.fn>;
  };
  let communityConnections: {
    findById: ReturnType<typeof vi.fn>;
    findCredentialsCiphertextById: ReturnType<typeof vi.fn>;
  };
  let communityService: { checkHealth: ReturnType<typeof vi.fn> };
  let activities: ReturnType<typeof createSnapshotActivities>;

  beforeEach(() => {
    env = new MockActivityEnvironment();
    snapshotService = {
      findByIdOrNull: vi.fn(),
      applyExternalUpdate: vi.fn(),
    };
    communityConnections = {
      findById: vi.fn(),
      findCredentialsCiphertextById: vi.fn(),
    };
    communityService = { checkHealth: vi.fn() };
    activities = createSnapshotActivities(
      snapshotService as unknown as SnapshotService,
      communityConnections as unknown as CommunityConnectionRepository,
      communityService as unknown as CommunityService,
    );
  });

  describe('getSnapshot', () => {
    it('returns the mapped DTO when the row exists', async () => {
      snapshotService.findByIdOrNull.mockResolvedValue(makeRow());

      const snapshot = await env.run(activities.getSnapshot, { snapshotId: SNAPSHOT_ID });

      expect(snapshotService.findByIdOrNull).toHaveBeenCalledWith(SNAPSHOT_ID);
      expect(snapshot.id).toBe(SNAPSHOT_ID);
      expect(snapshot.algorithmPresetId).toBe(PRESET_ID);
      expect(snapshot.createdAt).toBe(FIXED_NOW.toISOString());
      expect(snapshot.algorithmPresetFrozen.createdAt).toBe(FIXED_NOW.toISOString());
    });

    it('throws a non-retryable ApplicationFailure when the row is missing', async () => {
      snapshotService.findByIdOrNull.mockResolvedValue(null);

      const error = await env.run(activities.getSnapshot, { snapshotId: SNAPSHOT_ID }).catch((e) => e);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
      expect((error as ApplicationFailure).type).toBe('SnapshotNotFoundError');
    });
  });

  describe('updateSnapshot', () => {
    it('delegates to SnapshotService.applyExternalUpdate', async () => {
      snapshotService.applyExternalUpdate.mockResolvedValue(makeRow({ status: 'running' }));

      await env.run(activities.updateSnapshot, { snapshotId: SNAPSHOT_ID, status: 'running' });

      expect(snapshotService.applyExternalUpdate).toHaveBeenCalledWith({ snapshotId: SNAPSHOT_ID, status: 'running' });
    });

    it('throws a non-retryable ApplicationFailure when the row is missing', async () => {
      snapshotService.applyExternalUpdate.mockResolvedValue(null);

      const error = await env
        .run(activities.updateSnapshot, { snapshotId: SNAPSHOT_ID, status: 'completed' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
      expect((error as ApplicationFailure).type).toBe('SnapshotNotFoundError');
    });
  });

  describe('getCommunitySealedCredential', () => {
    const CONNECTION_ID = '01940000-0000-7000-8000-000000000002';

    it('returns the envelope still sealed, so no token enters workflow history', async () => {
      communityConnections.findCredentialsCiphertextById.mockResolvedValue('ccv1:keyid123:iv:tag:ciphertext');

      const result = await env.run(activities.getCommunitySealedCredential, { connectionId: CONNECTION_ID });

      expect(communityConnections.findCredentialsCiphertextById).toHaveBeenCalledWith(CONNECTION_ID);
      expect(result).toEqual({ credentialsCiphertext: 'ccv1:keyid123:iv:tag:ciphertext' });
    });

    it('fails non-retryably when the connection stores no credential', async () => {
      communityConnections.findCredentialsCiphertextById.mockResolvedValue(null);

      const error = await env
        .run(activities.getCommunitySealedCredential, { connectionId: CONNECTION_ID })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
      expect((error as ApplicationFailure).type).toBe('CommunityCredentialNotFoundError');
    });
  });

  describe('checkCommunityConnectionHealth', () => {
    const CONNECTION_ID = '01940000-0000-7000-8000-000000000002';

    it('delegates to the community service as a system actor and returns the health', async () => {
      const health = { status: 'broken', checkedAt: FIXED_NOW.toISOString(), reason: 'kicked' };
      communityService.checkHealth.mockResolvedValue(health);

      const result = await env.run(activities.checkCommunityConnectionHealth, { connectionId: CONNECTION_ID });

      expect(communityService.checkHealth).toHaveBeenCalledWith(null, CONNECTION_ID);
      expect(result).toEqual(health);
    });

    it('maps a missing or disconnected connection to a non-retryable failure', async () => {
      communityService.checkHealth.mockRejectedValue(new Error('not found'));

      const error = await env
        .run(activities.checkCommunityConnectionHealth, { connectionId: CONNECTION_ID })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect((error as ApplicationFailure).nonRetryable).toBe(true);
      expect((error as ApplicationFailure).type).toBe('CommunityConnectionNotFoundError');
    });
  });
});

describe('toSnapshotDto', () => {
  it('serialises Date fields to ISO strings and preserves optional fields', () => {
    const dto = toSnapshotDto(
      makeRow({
        status: 'running',
        startedAt: FIXED_NOW,
        temporal: { workflowId: 'wf-1' },
        outputs: { csv: 'snapshots/x.csv' },
      }) as unknown as Parameters<typeof toSnapshotDto>[0],
    );

    expect(dto.startedAt).toBe(FIXED_NOW.toISOString());
    expect(dto.temporal).toEqual({ workflowId: 'wf-1' });
    expect(dto.outputs).toEqual({ csv: 'snapshots/x.csv' });
    expect(dto.completedAt).toBeUndefined();
  });
});

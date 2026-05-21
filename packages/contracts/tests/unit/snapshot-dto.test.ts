import { describe, expect, it } from 'vitest';

import { type SnapshotDto, SnapshotStatus, type UpdateSnapshotInput } from '../../src/index.js';

const buildSnapshot = (): SnapshotDto => ({
  id: '0190a4d0-7b71-7c44-9bca-7f12c5c30001',
  status: SnapshotStatus.running,
  algorithmPresetId: '0190a4d0-7b71-7c44-9bca-7f12c5c30002',
  algorithmPresetFrozen: {
    key: 'voting-engagement',
    version: '1.0.0',
    inputs: [{ key: 'csv', value: 'uploads/abc/votes.csv' }],
    name: 'Voting Engagement',
  },
  temporal: {
    workflowId: 'snapshot-0190a4d0',
    runId: 'run-0190a4d0',
    taskQueue: 'reputation-algorithms',
    algorithmTaskQueue: 'reputation-algorithms',
  },
  outputs: { voting_engagement: 'snapshots/0190a4d0/voting_engagement.csv' },
  startedAt: '2026-05-21T09:00:00.000Z',
  createdAt: '2026-05-21T08:59:59.000Z',
  updatedAt: '2026-05-21T09:00:00.000Z',
});

describe('@reputo/contracts snapshot wire DTOs', () => {
  it('SnapshotDto round-trips through JSON without losing fields', () => {
    const original = buildSnapshot();

    const cloned = JSON.parse(JSON.stringify(original)) as SnapshotDto;

    expect(cloned).toEqual(original);
  });

  it('UpdateSnapshotInput has no seq field on the wire', () => {
    const update: UpdateSnapshotInput = {
      snapshotId: '0190a4d0-7b71-7c44-9bca-7f12c5c30001',
      status: SnapshotStatus.completed,
      outputs: { csv: 'snapshots/0190a4d0/votes.csv' },
    };

    expect((update as unknown as Record<string, unknown>).seq).toBeUndefined();

    const cloned = JSON.parse(JSON.stringify(update)) as UpdateSnapshotInput;
    expect(cloned).toEqual(update);
  });
});

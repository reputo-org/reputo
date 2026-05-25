import type { INestApplication } from '@nestjs/common';
import { SnapshotStatus } from '@reputo/contracts';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AlgorithmPresetEntity, AlgorithmPresetInputEntity, SnapshotEntity } from '../../../src/persistence';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('DELETE /api/v1/algorithm-presets/:id', () => {
  let app: INestApplication;
  let authCookie: string;
  let dataSource: DataSource;

  beforeAll(async () => {
    const boot = await createTestApp({});
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    authCookie = (await createAuthenticatedSession(boot.moduleRef)).cookie;
  });

  afterEach(async () => {
    await truncateBusinessTables(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should delete preset by id (204) with no body', async () => {
    const preset = await insertAlgorithmPreset(dataSource);

    const res = await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    expect(res.body).toEqual({});
    expect(res.text).toBe('');

    const count = await dataSource.getRepository(AlgorithmPresetEntity).count({ where: { id: preset.id } });
    expect(count).toBe(0);
  });

  it('should return 400 for invalid id format', async () => {
    await api(app, authCookie).delete('/algorithm-presets/invalid-id').expect(400);
  });

  it('should return 404 when preset does not exist', async () => {
    await api(app, authCookie).delete(`/algorithm-presets/${randomUUIDv7()}`).expect(404);
  });

  it('should make subsequent GET by id return 404 after deletion', async () => {
    const preset = await insertAlgorithmPreset(dataSource);

    await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    await api(app, authCookie).get(`/algorithm-presets/${preset.id}`).expect(404);
  });

  it('should cascade delete snapshots referencing the preset', async () => {
    const preset = await insertAlgorithmPreset(dataSource, {
      key: 'test_key',
      version: '1.0.0',
      inputs: [],
    });
    const snapshotRepo = dataSource.getRepository(SnapshotEntity);
    await snapshotRepo.save(
      snapshotRepo.create({
        algorithmPresetId: preset.id,
        algorithmPresetFrozen: {
          key: preset.key,
          version: preset.version,
        },
        status: SnapshotStatus.queued,
      }),
    );

    await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    const snapshotCount = await snapshotRepo.count({ where: { algorithmPresetId: preset.id } });
    expect(snapshotCount).toBe(0);
    const presetCount = await dataSource.getRepository(AlgorithmPresetEntity).count({ where: { id: preset.id } });
    expect(presetCount).toBe(0);
  });

  it('should cascade delete child algorithm_preset_inputs rows when the preset is deleted', async () => {
    const preset = await insertAlgorithmPreset(dataSource, {
      inputs: [
        { key: 'a', value: 1 },
        { key: 'b', value: 'two' },
        { key: 'c', value: { nested: true } },
      ],
    });

    const inputRepo = dataSource.getRepository(AlgorithmPresetInputEntity);
    const before = await inputRepo.count({ where: { algorithmPresetId: preset.id } });
    expect(before).toBe(3);

    await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    const after = await inputRepo.count({ where: { algorithmPresetId: preset.id } });
    expect(after).toBe(0);
  });
});

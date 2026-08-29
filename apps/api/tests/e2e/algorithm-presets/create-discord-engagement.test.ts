import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityConnectionEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { api } from '../../utils/request';

describe('POST /api/v1/algorithm-presets (discord_engagement)', () => {
  let app: INestApplication;
  let authCookie: string;
  let dataSource: DataSource;
  let connectionId: string;
  const listResources = vi.fn();

  beforeAll(async () => {
    const boot = await createTestApp({
      discordClient: { listResources } as never,
    });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    authCookie = (await createAuthenticatedSession(boot.moduleRef)).cookie;
  });

  beforeEach(async () => {
    listResources.mockReset();
    listResources.mockResolvedValue([
      { id: 'c1', name: 'general', kind: 'text' },
      { id: 'c2', name: 'dev', kind: 'forum' },
    ]);
    const repo = dataSource.getRepository(CommunityConnectionEntity);
    const saved = await repo.save(
      repo.create({ platform: 'discord', externalId: 'guild-1', name: 'SNET', status: 'active' }),
    );
    connectionId = saved.id;
  });

  afterEach(async () => {
    await truncateBusinessTables(dataSource);
    await dataSource.query('TRUNCATE TABLE community_connection_audit, community_connections CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  const makeDto = (overrides: Record<string, unknown> = {}) => ({
    key: 'discord_engagement',
    version: '1.0.0',
    inputs: [
      { key: 'community_connection_id', value: connectionId },
      { key: 'resources', value: ['c1', 'c2'] },
      { key: 'lookback_days', value: 90 },
      {
        key: 'activities',
        value: [
          { activity: 'message', points: 1, daily_cap: 25 },
          { activity: 'active_day', points: 2, daily_cap: 30 },
        ],
      },
    ],
    ...overrides,
  });

  const withInput = (key: string, value: unknown) => {
    const dto = makeDto();
    dto.inputs = dto.inputs.map((input) => (input.key === key ? { key, value } : input));
    return dto;
  };

  it('creates a valid preset against an active connection with known channels (201)', async () => {
    const res = await api(app, authCookie).post('/algorithm-presets').send(makeDto()).expect(201);

    expect(res.body.key).toBe('discord_engagement');
    expect(listResources).toHaveBeenCalledWith('guild-1');
  });

  it('rejects unknown resource ids (400), naming them', async () => {
    const res = await api(app, authCookie)
      .post('/algorithm-presets')
      .send(withInput('resources', ['c1', 'deleted-channel']))
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('deleted-channel');
  });

  it('rejects a lookback beyond 183 days (400)', async () => {
    await api(app, authCookie).post('/algorithm-presets').send(withInput('lookback_days', 184)).expect(400);
  });

  it('rejects non-positive activity weights — zero weight is invalid app-wide (400)', async () => {
    for (const points of [0, -1]) {
      await api(app, authCookie)
        .post('/algorithm-presets')
        .send(withInput('activities', [{ activity: 'message', points, daily_cap: 25 }]))
        .expect(400);
    }
  });

  it('rejects a duplicated activity row (400)', async () => {
    await api(app, authCookie)
      .post('/algorithm-presets')
      .send(
        withInput('activities', [
          { activity: 'message', points: 1, daily_cap: 25 },
          { activity: 'message', points: 2, daily_cap: 10 },
        ]),
      )
      .expect(400);
  });

  it('rejects a connection that exists but is not active (400)', async () => {
    await dataSource.getRepository(CommunityConnectionEntity).update({ id: connectionId }, { status: 'broken' });

    const res = await api(app, authCookie).post('/algorithm-presets').send(makeDto()).expect(400);

    expect(JSON.stringify(res.body)).toContain('broken');
  });

  it('rejects a missing connection (400) without calling the platform', async () => {
    const res = await api(app, authCookie)
      .post('/algorithm-presets')
      .send(withInput('community_connection_id', '01990000-0000-7000-8000-00000000dead'))
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('not found');
    expect(listResources).not.toHaveBeenCalled();
  });

  it('validates community inputs inside custom_score children too (400 with prefixed field)', async () => {
    const res = await api(app, authCookie)
      .post('/algorithm-presets')
      .send({
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'discord_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: withInput('resources', ['ghost-channel']).inputs,
              },
            ],
          },
        ],
      })
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('sub_algorithms.0.inputs.resources');
  });
});

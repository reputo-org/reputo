import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityConnectionEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { api } from '../../utils/request';

describe('POST /api/v1/algorithm-presets (github_engagement)', () => {
  let app: INestApplication;
  let authCookie: string;
  let dataSource: DataSource;
  let connectionId: string;
  const listResources = vi.fn();

  beforeAll(async () => {
    const boot = await createTestApp({
      githubClient: { listResources } as never,
    });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    authCookie = (await createAuthenticatedSession(boot.moduleRef)).cookie;
  });

  beforeEach(async () => {
    listResources.mockReset();
    listResources.mockResolvedValue([
      { id: '9001', name: 'snet/reputo', kind: 'repository' },
      { id: '9002', name: 'snet/deep-id', kind: 'repository' },
    ]);
    const repo = dataSource.getRepository(CommunityConnectionEntity);
    const saved = await repo.save(
      repo.create({ platform: 'github', externalId: 'inst-1', name: 'snet', status: 'active' }),
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
    key: 'github_engagement',
    version: '1.0.0',
    inputs: [
      { key: 'community_connection_id', value: connectionId },
      { key: 'resources', value: ['9001', '9002'] },
      { key: 'lookback_days', value: 90 },
      {
        key: 'activities',
        value: [
          { activity: 'pull_request_merged', points: 15, daily_cap: 5 },
          { activity: 'comment', points: 1, daily_cap: 20 },
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

  it('creates a valid preset against an active connection with known repositories (201)', async () => {
    const res = await api(app, authCookie).post('/algorithm-presets').send(makeDto()).expect(201);

    expect(res.body.key).toBe('github_engagement');
    expect(listResources).toHaveBeenCalledWith('inst-1');
  });

  it('rejects unknown resource ids (400), naming them', async () => {
    const res = await api(app, authCookie)
      .post('/algorithm-presets')
      .send(withInput('resources', ['9001', 'gone-repo']))
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('gone-repo');
  });

  it('rejects a lookback beyond 183 days (400)', async () => {
    await api(app, authCookie).post('/algorithm-presets').send(withInput('lookback_days', 184)).expect(400);
  });

  it('rejects non-positive activity weights — zero weight is invalid app-wide (400)', async () => {
    for (const points of [0, -1]) {
      await api(app, authCookie)
        .post('/algorithm-presets')
        .send(withInput('activities', [{ activity: 'comment', points, daily_cap: 20 }]))
        .expect(400);
    }
  });

  it('rejects a connection on another platform (400)', async () => {
    const repo = dataSource.getRepository(CommunityConnectionEntity);
    const discord = await repo.save(
      repo.create({ platform: 'discord', externalId: 'guild-1', name: 'SNET', status: 'active' }),
    );

    const res = await api(app, authCookie)
      .post('/algorithm-presets')
      .send(withInput('community_connection_id', discord.id))
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('must be a github connection');
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
                algorithm_key: 'github_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: withInput('resources', ['ghost-repo']).inputs,
              },
            ],
          },
        ],
      })
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('sub_algorithms.0.inputs.resources');
  });
});

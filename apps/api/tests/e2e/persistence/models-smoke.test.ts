import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccessAllowlistEntity,
  AlgorithmPresetEntity,
  AlgorithmPresetInputEntity,
  AuthSessionEntity,
  ENTITIES,
  OAuthConsentGrantEntity,
  OAuthUserEntity,
  SnapshotEntity,
  SnapshotOutputEntity,
} from '../../../src/persistence/entities';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';

describe('TypeORM entities smoke', () => {
  let db: TestDatabase;
  let dataSource: DataSource;

  beforeAll(async () => {
    db = await startTestDatabase();
    dataSource = new DataSource({
      type: 'postgres',
      url: db.databaseUrl,
      entities: [...ENTITIES],
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    await db?.stop();
  });

  it('round-trips an AlgorithmPreset with relational inputs ordered by position', async () => {
    const presets = dataSource.getRepository(AlgorithmPresetEntity);
    const inputs = dataSource.getRepository(AlgorithmPresetInputEntity);

    const preset = await presets.save(
      presets.create({
        key: 'voting_engagement',
        version: '1.0.0',
        name: 'Default voting engagement',
        description: 'Baseline configuration used in regression tests.',
      }),
    );
    await inputs.save([
      inputs.create({ algorithmPresetId: preset.id, key: 'window_days', value: 30, position: 0 }),
      inputs.create({ algorithmPresetId: preset.id, key: 'min_votes', value: 5, position: 1 }),
    ]);

    const fetched = await presets.findOneOrFail({
      where: { id: preset.id },
      relations: { inputs: true },
    });

    expect(fetched.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetched.key).toBe('voting_engagement');
    expect(fetched.version).toBe('1.0.0');
    expect(
      [...fetched.inputs]
        .sort((a, b) => a.position - b.position)
        .map((input) => ({ key: input.key, value: input.value })),
    ).toEqual([
      { key: 'window_days', value: 30 },
      { key: 'min_votes', value: 5 },
    ]);
  });

  it('round-trips a Snapshot with frozen/temporal JSON, relational outputs, and the AlgorithmPreset FK', async () => {
    const presets = dataSource.getRepository(AlgorithmPresetEntity);
    const inputs = dataSource.getRepository(AlgorithmPresetInputEntity);
    const snapshots = dataSource.getRepository(SnapshotEntity);
    const outputs = dataSource.getRepository(SnapshotOutputEntity);

    const preset = await presets.save(presets.create({ key: 'token_holdings', version: '2.1.0' }));
    await inputs.save(inputs.create({ algorithmPresetId: preset.id, key: 'chain', value: 'cardano', position: 0 }));

    const snapshot = await snapshots.save(
      snapshots.create({
        algorithmPresetId: preset.id,
        algorithmPresetFrozen: {
          key: preset.key,
          version: preset.version,
          inputs: [{ key: 'chain', value: 'cardano' }],
        },
        temporal: {
          workflowId: 'wf-123',
          runId: 'run-123',
          taskQueue: 'orchestrator-worker',
          algorithmTaskQueue: 'algo-runner',
        },
        startedAt: new Date(),
      }),
    );
    await outputs.save(outputs.create({ snapshotId: snapshot.id, key: 'csv', value: 's3://bucket/out.csv' }));

    const refetched = await snapshots.findOneOrFail({
      where: { id: snapshot.id },
      relations: { algorithmPreset: true, outputs: true },
    });
    expect(refetched.status).toBe('queued');
    expect(refetched.algorithmPresetId).toBe(preset.id);
    expect(refetched.algorithmPreset.id).toBe(preset.id);
    expect((refetched.algorithmPresetFrozen as { key: string }).key).toBe('token_holdings');
    expect(refetched.outputs.map((o) => ({ key: o.key, value: o.value }))).toEqual([
      { key: 'csv', value: 's3://bucket/out.csv' },
    ]);
  });

  it('cascades snapshot deletion to the child snapshot_outputs rows', async () => {
    const presets = dataSource.getRepository(AlgorithmPresetEntity);
    const snapshots = dataSource.getRepository(SnapshotEntity);
    const outputs = dataSource.getRepository(SnapshotOutputEntity);

    const preset = await presets.save(presets.create({ key: 'cascade_check', version: '1.0.0' }));
    const snapshot = await snapshots.save(
      snapshots.create({
        algorithmPresetId: preset.id,
        algorithmPresetFrozen: { key: preset.key, version: preset.version, inputs: [] },
      }),
    );
    await outputs.save([
      outputs.create({ snapshotId: snapshot.id, key: 'csv', value: 's3://bucket/a.csv' }),
      outputs.create({ snapshotId: snapshot.id, key: 'json', value: 's3://bucket/a.json' }),
    ]);

    expect(await outputs.count({ where: { snapshotId: snapshot.id } })).toBe(2);

    await snapshots.delete({ id: snapshot.id });

    expect(await outputs.count({ where: { snapshotId: snapshot.id } })).toBe(0);
  });

  it('round-trips an OAuthUser and rejects duplicate (provider, sub)', async () => {
    const users = dataSource.getRepository(OAuthUserEntity);

    const user = await users.save(
      users.create({
        provider: 'deep-id',
        sub: 'sub-1',
        aud: ['reputo-api'],
        authTime: 1_700_000_000,
        email: 'user@example.com',
        emailVerified: true,
        iat: 1_700_000_000,
        iss: 'https://identity.deep-id.ai',
        picture: 'https://cdn.example.com/u.png',
        rat: 1_700_000_000,
        username: 'user',
      }),
    );

    expect(user.aud).toEqual(['reputo-api']);
    expect(user.emailVerified).toBe(true);

    await expect(users.save(users.create({ provider: 'deep-id', sub: 'sub-1', aud: [] }))).rejects.toThrow();
  });

  it('round-trips an AuthSession and cascades when its OAuthUser is deleted', async () => {
    const users = dataSource.getRepository(OAuthUserEntity);
    const sessions = dataSource.getRepository(AuthSessionEntity);

    const user = await users.save(users.create({ provider: 'deep-id', sub: 'sub-session', aud: [] }));
    const session = await sessions.save(
      sessions.create({
        sessionId: 'session-1',
        provider: 'deep-id',
        userId: user.id,
        accessTokenCiphertext: 'ct-access',
        refreshTokenCiphertext: 'ct-refresh',
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        refreshTokenExpiresAt: new Date(Date.now() + 600_000),
        scope: ['openid', 'profile'],
        state: 'state-1',
        codeVerifier: 'verifier-1',
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );

    const fetched = await sessions.findOneOrFail({ where: { sessionId: 'session-1' } });
    expect(fetched.id).toBe(session.id);
    expect(fetched.scope).toEqual(['openid', 'profile']);

    await users.delete({ id: user.id });
    const cascaded = await sessions.findOne({ where: { id: session.id } });
    expect(cascaded).toBeNull();
  });

  it('round-trips an OAuthConsentGrant with unique state', async () => {
    const consents = dataSource.getRepository(OAuthConsentGrantEntity);

    const grant = await consents.save(
      consents.create({
        provider: 'deep-id',
        source: 'voting-portal',
        state: 'consent-state-1',
        codeVerifier: 'consent-verifier-1',
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );

    expect(grant.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      consents.save(
        consents.create({
          provider: 'deep-id',
          source: 'voting-portal',
          state: 'consent-state-1',
          codeVerifier: 'other-verifier',
          expiresAt: new Date(Date.now() + 600_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it('round-trips an AccessAllowlist row and nulls invitedBy/revokedBy on user delete', async () => {
    const users = dataSource.getRepository(OAuthUserEntity);
    const allowlist = dataSource.getRepository(AccessAllowlistEntity);

    const inviter = await users.save(users.create({ provider: 'deep-id', sub: 'sub-inviter', aud: [] }));
    const revoker = await users.save(users.create({ provider: 'deep-id', sub: 'sub-revoker', aud: [] }));

    const entry = await allowlist.save(
      allowlist.create({
        provider: 'deep-id',
        email: 'allowed@example.com',
        role: 'admin',
        invitedByUserId: inviter.id,
        revokedAt: new Date(),
        revokedByUserId: revoker.id,
      }),
    );

    expect(entry.role).toBe('admin');

    await users.delete({ id: inviter.id });
    await users.delete({ id: revoker.id });

    const stillThere = await allowlist.findOneOrFail({ where: { id: entry.id } });
    expect(stillThere.invitedByUserId).toBeNull();
    expect(stillThere.revokedByUserId).toBeNull();
  });
});

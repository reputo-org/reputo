import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../src/persistence';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';

// End-to-end smoke covering insert + read for every model defined in
// `prisma/schema.prisma`. No consumers are wired yet (tasks 05–07 ship the
// real repositories); this only proves the generated client, FKs, and
// indexes line up with the source-of-truth Mongoose schemas.

describe('Prisma models smoke', () => {
  let db: TestDatabase;
  let prisma: PrismaService;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await db?.stop();
  });

  it('round-trips an AlgorithmPreset with JSON inputs', async () => {
    const created = await prisma.algorithmPreset.create({
      data: {
        key: 'voting_engagement',
        version: '1.0.0',
        inputs: [
          { key: 'window_days', value: 30 },
          { key: 'min_votes', value: 5 },
        ],
        name: 'Default voting engagement',
        description: 'Baseline configuration used in regression tests.',
      },
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.inputs).toEqual([
      { key: 'window_days', value: 30 },
      { key: 'min_votes', value: 5 },
    ]);

    const fetched = await prisma.algorithmPreset.findUniqueOrThrow({ where: { id: created.id } });
    expect(fetched.key).toBe('voting_engagement');
    expect(fetched.version).toBe('1.0.0');
  });

  it('round-trips a Snapshot with frozen/temporal/outputs JSON and the AlgorithmPreset FK', async () => {
    const preset = await prisma.algorithmPreset.create({
      data: {
        key: 'token_holdings',
        version: '2.1.0',
        inputs: [{ key: 'chain', value: 'cardano' }],
      },
    });

    const snapshot = await prisma.snapshot.create({
      data: {
        algorithmPresetId: preset.id,
        algorithmPresetFrozen: {
          key: preset.key,
          version: preset.version,
          inputs: preset.inputs as unknown[],
        },
        temporal: {
          workflowId: 'wf-123',
          runId: 'run-123',
          taskQueue: 'orchestrator-worker',
          algorithmTaskQueue: 'algo-runner',
        },
        outputs: { csv: 's3://bucket/out.csv' },
        startedAt: new Date(),
      },
    });

    expect(snapshot.status).toBe('queued');
    expect(snapshot.algorithmPresetId).toBe(preset.id);

    const refetched = await prisma.snapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
      include: { algorithmPreset: true },
    });
    expect(refetched.algorithmPreset.id).toBe(preset.id);
    expect((refetched.algorithmPresetFrozen as { key: string }).key).toBe('token_holdings');
  });

  it('round-trips an OAuthUser and rejects duplicate (provider, sub)', async () => {
    const user = await prisma.oAuthUser.create({
      data: {
        provider: 'deep_id',
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
      },
    });

    expect(user.aud).toEqual(['reputo-api']);
    expect(user.emailVerified).toBe(true);

    await expect(
      prisma.oAuthUser.create({
        data: { provider: 'deep_id', sub: 'sub-1' },
      }),
    ).rejects.toThrow();
  });

  it('round-trips an AuthSession and cascades when its OAuthUser is deleted', async () => {
    const user = await prisma.oAuthUser.create({
      data: { provider: 'deep_id', sub: 'sub-session' },
    });

    const session = await prisma.authSession.create({
      data: {
        sessionId: 'session-1',
        provider: 'deep_id',
        userId: user.id,
        accessTokenCiphertext: 'ct-access',
        refreshTokenCiphertext: 'ct-refresh',
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        refreshTokenExpiresAt: new Date(Date.now() + 600_000),
        scope: ['openid', 'profile'],
        state: 'state-1',
        codeVerifier: 'verifier-1',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const fetched = await prisma.authSession.findUniqueOrThrow({ where: { sessionId: 'session-1' } });
    expect(fetched.id).toBe(session.id);
    expect(fetched.scope).toEqual(['openid', 'profile']);

    await prisma.oAuthUser.delete({ where: { id: user.id } });
    const cascaded = await prisma.authSession.findUnique({ where: { id: session.id } });
    expect(cascaded).toBeNull();
  });

  it('round-trips an OAuthConsentGrant with unique state', async () => {
    const grant = await prisma.oAuthConsentGrant.create({
      data: {
        provider: 'deep_id',
        source: 'voting-portal',
        state: 'consent-state-1',
        codeVerifier: 'consent-verifier-1',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    expect(grant.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      prisma.oAuthConsentGrant.create({
        data: {
          provider: 'deep_id',
          source: 'voting-portal',
          state: 'consent-state-1',
          codeVerifier: 'other-verifier',
          expiresAt: new Date(Date.now() + 600_000),
        },
      }),
    ).rejects.toThrow();
  });

  it('round-trips an AccessAllowlist row and nulls invitedBy/revokedBy on user delete', async () => {
    const inviter = await prisma.oAuthUser.create({
      data: { provider: 'deep_id', sub: 'sub-inviter' },
    });
    const revoker = await prisma.oAuthUser.create({
      data: { provider: 'deep_id', sub: 'sub-revoker' },
    });

    const entry = await prisma.accessAllowlist.create({
      data: {
        provider: 'deep_id',
        email: 'allowed@example.com',
        role: 'admin',
        invitedBy: inviter.id,
        revokedAt: new Date(),
        revokedBy: revoker.id,
      },
    });

    expect(entry.role).toBe('admin');

    await prisma.oAuthUser.delete({ where: { id: inviter.id } });
    await prisma.oAuthUser.delete({ where: { id: revoker.id } });

    const stillThere = await prisma.accessAllowlist.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stillThere.invitedBy).toBeNull();
    expect(stillThere.revokedBy).toBeNull();
  });
});

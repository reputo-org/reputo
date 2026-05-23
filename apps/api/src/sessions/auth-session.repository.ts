import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { OAuthProvider } from '@reputo/contracts';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { AuthSessionEntity } from '../persistence';

// Public AuthSession shape — non-secret fields only. Used by guards, view
// models, and any caller that doesn't need to decrypt provider tokens.
export interface AuthSessionRow {
  _id: string;
  sessionId: string;
  provider: OAuthProvider;
  userId: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  scope: string[];
  lastRefreshedAt?: Date;
  revokedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Full AuthSession shape including encrypted tokens, PKCE verifier, and the
// CSRF state. Returned only by the privileged helpers used inside the refresh
// path.
export interface AuthSessionWithSecrets extends AuthSessionRow {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  state: string;
  codeVerifier: string;
}

export interface AuthSessionCreateInput {
  sessionId: string;
  provider: OAuthProvider;
  userId: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  scope: string[];
  state: string;
  codeVerifier: string;
  expiresAt: Date;
}

export interface AuthSessionUpdateAfterRefreshInput {
  accessTokenCiphertext?: string;
  refreshTokenCiphertext?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string[];
  lastRefreshedAt?: Date;
  expiresAt?: Date;
}

export interface UserSessionActivity {
  lastSignInAt: Date | null;
  activeSessionCount: number;
}

function mapPublicRow(entity: AuthSessionEntity): AuthSessionRow {
  return {
    _id: entity.id,
    sessionId: entity.sessionId,
    provider: entity.provider,
    userId: entity.userId,
    accessTokenExpiresAt: entity.accessTokenExpiresAt,
    refreshTokenExpiresAt: entity.refreshTokenExpiresAt,
    scope: entity.scope,
    lastRefreshedAt: entity.lastRefreshedAt ?? undefined,
    revokedAt: entity.revokedAt ?? undefined,
    expiresAt: entity.expiresAt,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function mapRowWithSecrets(entity: AuthSessionEntity): AuthSessionWithSecrets {
  return {
    ...mapPublicRow(entity),
    accessTokenCiphertext: entity.accessTokenCiphertext,
    refreshTokenCiphertext: entity.refreshTokenCiphertext,
    state: entity.state,
    codeVerifier: entity.codeVerifier,
  };
}

@Injectable()
export class AuthSessionRepository {
  constructor(
    @InjectRepository(AuthSessionEntity)
    private readonly repo: Repository<AuthSessionEntity>,
  ) {}

  // Returned shape includes secrets because the create path is the only one
  // that already holds the plaintext (callers just minted them) and the
  // session row is immediately consumed for cookie issuance.
  async create(data: AuthSessionCreateInput): Promise<AuthSessionWithSecrets> {
    const entity = this.repo.create({
      sessionId: data.sessionId,
      provider: data.provider,
      userId: data.userId,
      accessTokenCiphertext: data.accessTokenCiphertext,
      refreshTokenCiphertext: data.refreshTokenCiphertext,
      accessTokenExpiresAt: data.accessTokenExpiresAt,
      refreshTokenExpiresAt: data.refreshTokenExpiresAt,
      scope: data.scope,
      state: data.state,
      codeVerifier: data.codeVerifier,
      expiresAt: data.expiresAt,
      lastRefreshedAt: null,
      revokedAt: null,
    });
    const saved = await this.repo.save(entity);
    return mapRowWithSecrets(saved);
  }

  // Overload: callers explicitly opt in to the privileged shape (including
  // secrets) by passing `true`; everyone else gets the public projection.
  findActiveBySessionId(sessionId: string): Promise<AuthSessionRow | null>;
  findActiveBySessionId(sessionId: string, includeSecrets: true): Promise<AuthSessionWithSecrets | null>;
  findActiveBySessionId(sessionId: string, includeSecrets: false): Promise<AuthSessionRow | null>;
  async findActiveBySessionId(
    sessionId: string,
    includeSecrets = false,
  ): Promise<AuthSessionRow | AuthSessionWithSecrets | null> {
    const entity = await this.repo.findOne({
      where: {
        sessionId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!entity) return null;
    return includeSecrets ? mapRowWithSecrets(entity) : mapPublicRow(entity);
  }

  // Privileged convenience: explicit name so refresh-path callers don't need
  // to remember the boolean flag.
  async findActiveBySessionIdWithSecrets(sessionId: string): Promise<AuthSessionWithSecrets | null> {
    return this.findActiveBySessionId(sessionId, true);
  }

  async updateAfterRefresh(
    sessionId: string,
    update: AuthSessionUpdateAfterRefreshInput,
  ): Promise<AuthSessionWithSecrets | null> {
    const entity = await this.repo.findOne({
      where: {
        sessionId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!entity) return null;

    if (update.accessTokenCiphertext !== undefined) entity.accessTokenCiphertext = update.accessTokenCiphertext;
    if (update.refreshTokenCiphertext !== undefined) entity.refreshTokenCiphertext = update.refreshTokenCiphertext;
    if (update.accessTokenExpiresAt !== undefined) entity.accessTokenExpiresAt = update.accessTokenExpiresAt;
    if (update.refreshTokenExpiresAt !== undefined) entity.refreshTokenExpiresAt = update.refreshTokenExpiresAt;
    if (update.scope !== undefined) entity.scope = update.scope;
    if (update.lastRefreshedAt !== undefined) entity.lastRefreshedAt = update.lastRefreshedAt;
    if (update.expiresAt !== undefined) entity.expiresAt = update.expiresAt;

    const saved = await this.repo.save(entity);
    return mapRowWithSecrets(saved);
  }

  async revokeBySessionId(sessionId: string, revokedAt = new Date()): Promise<void> {
    await this.repo.update({ sessionId, revokedAt: IsNull() }, { revokedAt, expiresAt: revokedAt });
  }

  async revokeAllByUserId(userId: string, revokedAt = new Date()): Promise<number> {
    const result = await this.repo.update(
      { userId, revokedAt: IsNull(), expiresAt: MoreThan(revokedAt) },
      { revokedAt, expiresAt: revokedAt },
    );
    return result.affected ?? 0;
  }

  async deleteExpired(now = new Date()): Promise<{ deletedCount: number }> {
    const qb = this.repo.createQueryBuilder().delete().where('expires_at < :now', { now });
    const result = await qb.execute();
    return { deletedCount: result.affected ?? 0 };
  }

  // Returns Map<userId, { lastSignInAt, activeSessionCount }>. Users with no
  // sessions are omitted; users whose sessions are all revoked or expired
  // appear with `activeSessionCount: 0`.
  async aggregateActivityByUserIds(
    userIds: ReadonlyArray<string>,
    now = new Date(),
  ): Promise<Map<string, UserSessionActivity>> {
    const activity = new Map<string, UserSessionActivity>();
    if (userIds.length === 0) return activity;

    const ids = [...userIds];
    // Two grouped queries — `findAndCount`/`groupBy` over the same column with
    // different filters isn't expressible in a single QueryBuilder.
    const [lastSignInRows, activeCountRows] = await Promise.all([
      this.repo
        .createQueryBuilder('s')
        .select('s.user_id', 'userId')
        .addSelect('MAX(s.created_at)', 'lastSignInAt')
        .where({ userId: In(ids) })
        .groupBy('s.user_id')
        .getRawMany<{ userId: string; lastSignInAt: Date | null }>(),
      this.repo
        .createQueryBuilder('s')
        .select('s.user_id', 'userId')
        .addSelect('COUNT(*)::int', 'count')
        .where({ userId: In(ids), revokedAt: IsNull(), expiresAt: MoreThan(now) })
        .groupBy('s.user_id')
        .getRawMany<{ userId: string; count: number }>(),
    ]);

    const activeCountByUserId = new Map<string, number>();
    for (const row of activeCountRows) {
      activeCountByUserId.set(row.userId, Number(row.count));
    }

    for (const row of lastSignInRows) {
      activity.set(row.userId, {
        lastSignInAt: row.lastSignInAt ?? null,
        activeSessionCount: activeCountByUserId.get(row.userId) ?? 0,
      });
    }

    return activity;
  }
}

import { Injectable } from '@nestjs/common';
import type { AuthSession as PrismaAuthSession } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { OAuthProvider } from '@reputo/contracts';
import { PrismaService } from '../persistence';
import { toPrismaProvider, toWireProvider } from '../shared/utils';

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
// CSRF state. Returned only by the privileged helpers used inside the
// refresh path.
export interface AuthSessionWithSecrets extends AuthSessionRow {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  state: string;
  codeVerifier: string;
}

// Backwards-compatible alias — Mongoose-era consumers asked for the full
// row (including secrets). New code should pick AuthSessionRow or
// AuthSessionWithSecrets explicitly.
export type AuthSessionWithId = AuthSessionWithSecrets;

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

const isRecordNotFound = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';

function mapPublicRow(row: PrismaAuthSession): AuthSessionRow {
  return {
    _id: row.id,
    sessionId: row.sessionId,
    provider: toWireProvider(row.provider),
    userId: row.userId,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    scope: row.scope,
    lastRefreshedAt: row.lastRefreshedAt ?? undefined,
    revokedAt: row.revokedAt ?? undefined,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRowWithSecrets(row: PrismaAuthSession): AuthSessionWithSecrets {
  return {
    ...mapPublicRow(row),
    accessTokenCiphertext: row.accessTokenCiphertext,
    refreshTokenCiphertext: row.refreshTokenCiphertext,
    state: row.state,
    codeVerifier: row.codeVerifier,
  };
}

@Injectable()
export class AuthSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Returned shape includes secrets because the create path is the only one
  // that already holds the plaintext (callers just minted them) and the
  // session row is immediately consumed for cookie issuance.
  async create(data: AuthSessionCreateInput): Promise<AuthSessionWithSecrets> {
    const created = await this.prisma.authSession.create({
      data: {
        sessionId: data.sessionId,
        provider: toPrismaProvider(data.provider),
        userId: data.userId,
        accessTokenCiphertext: data.accessTokenCiphertext,
        refreshTokenCiphertext: data.refreshTokenCiphertext,
        accessTokenExpiresAt: data.accessTokenExpiresAt,
        refreshTokenExpiresAt: data.refreshTokenExpiresAt,
        scope: { set: data.scope },
        state: data.state,
        codeVerifier: data.codeVerifier,
        expiresAt: data.expiresAt,
      },
    });
    return mapRowWithSecrets(created);
  }

  // Overload: callers explicitly opt in to the privileged shape by passing
  // `true`; everyone else gets the public projection. Mirrors the previous
  // Mongoose `select('+accessTokenCiphertext ...')` toggle.
  findActiveBySessionId(sessionId: string): Promise<AuthSessionRow | null>;
  findActiveBySessionId(sessionId: string, includeSecrets: true): Promise<AuthSessionWithSecrets | null>;
  findActiveBySessionId(sessionId: string, includeSecrets: false): Promise<AuthSessionRow | null>;
  async findActiveBySessionId(
    sessionId: string,
    includeSecrets = false,
  ): Promise<AuthSessionRow | AuthSessionWithSecrets | null> {
    const row = await this.prisma.authSession.findFirst({
      where: {
        sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) return null;
    return includeSecrets ? mapRowWithSecrets(row) : mapPublicRow(row);
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
    const data: Prisma.AuthSessionUpdateInput = {};
    if (update.accessTokenCiphertext !== undefined) data.accessTokenCiphertext = update.accessTokenCiphertext;
    if (update.refreshTokenCiphertext !== undefined) data.refreshTokenCiphertext = update.refreshTokenCiphertext;
    if (update.accessTokenExpiresAt !== undefined) data.accessTokenExpiresAt = update.accessTokenExpiresAt;
    if (update.refreshTokenExpiresAt !== undefined) data.refreshTokenExpiresAt = update.refreshTokenExpiresAt;
    if (update.scope !== undefined) data.scope = { set: update.scope };
    if (update.lastRefreshedAt !== undefined) data.lastRefreshedAt = update.lastRefreshedAt;
    if (update.expiresAt !== undefined) data.expiresAt = update.expiresAt;

    try {
      const row = await this.prisma.authSession.update({
        where: { sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
        data,
      });
      return mapRowWithSecrets(row);
    } catch (err) {
      // The compound `where` (non-unique fields after the unique
      // `sessionId`) emits P2025 when the row exists but no longer matches
      // the active-session filter — preserve the Mongoose
      // `findOneAndUpdate` semantics where that returns null.
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }

  async revokeBySessionId(sessionId: string, revokedAt = new Date()): Promise<void> {
    try {
      await this.prisma.authSession.update({
        where: { sessionId, revokedAt: null },
        data: { revokedAt, expiresAt: revokedAt },
      });
    } catch (err) {
      if (isRecordNotFound(err)) return;
      throw err;
    }
  }

  async revokeAllByUserId(userId: string, revokedAt = new Date()): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: revokedAt },
      },
      data: { revokedAt, expiresAt: revokedAt },
    });
    return result.count;
  }

  // Returns Map<userId, { lastSignInAt, activeSessionCount }> with the same
  // shape as the previous Mongo aggregation. Users with no sessions are
  // omitted; users whose sessions are all revoked or expired appear with
  // `activeSessionCount: 0`.
  async aggregateActivityByUserIds(
    userIds: ReadonlyArray<string>,
    now = new Date(),
  ): Promise<Map<string, UserSessionActivity>> {
    const activity = new Map<string, UserSessionActivity>();
    if (userIds.length === 0) return activity;

    // Two groupBy queries — Prisma can't express a conditional/filtered
    // count alongside an unconditional aggregate in a single call, but the
    // input is bounded by the admin list page size (<=100) so the extra
    // round-trip is negligible.
    const ids = [...userIds];
    const [lastSignInRows, activeCountRows] = await Promise.all([
      this.prisma.authSession.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { createdAt: true },
      }),
      this.prisma.authSession.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: now } },
        _count: { _all: true },
      }),
    ]);

    const activeCountByUserId = new Map<string, number>();
    for (const row of activeCountRows) {
      activeCountByUserId.set(row.userId, row._count._all);
    }

    for (const row of lastSignInRows) {
      activity.set(row.userId, {
        lastSignInAt: row._max.createdAt ?? null,
        activeSessionCount: activeCountByUserId.get(row.userId) ?? 0,
      });
    }

    return activity;
  }
}

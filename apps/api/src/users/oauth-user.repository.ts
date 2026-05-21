import { Injectable } from '@nestjs/common';
import type { Prisma, OAuthUser as PrismaOAuthUser } from '@prisma/client';
import type { OAuthProvider } from '@reputo/contracts';
import { PrismaService } from '../persistence';
import { toPrismaProvider, toWireProvider } from '../shared/utils';

// Domain shape returned by the repository. Uses `_id` (instead of Prisma's
// `id`) and snake_case JWT-ish field names (`auth_time`, `email_verified`)
// to match the SessionUserView / `/auth/me` HTTP contract.
export interface OAuthUserRow {
  _id: string;
  provider: OAuthProvider;
  sub: string;
  aud?: string[];
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  iat?: number;
  iss?: string;
  picture?: string;
  rat?: number;
  username?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Subset of OAuthUserRow that callers may upsert. `provider`/`sub` are the
// upsert key and never appear here; timestamps are managed by Prisma.
export interface OAuthUserUpsertInput {
  aud?: string[];
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  iat?: number;
  iss?: string;
  picture?: string;
  rat?: number;
  username?: string;
}

function mapRow(row: PrismaOAuthUser): OAuthUserRow {
  return {
    _id: row.id,
    provider: toWireProvider(row.provider),
    sub: row.sub,
    // Collapse the `String[] @default([])` empty array back to undefined so
    // downstream JSON omits the field rather than emitting `"aud": []`.
    aud: row.aud.length > 0 ? row.aud : undefined,
    auth_time: row.authTime ?? undefined,
    email: row.email ?? undefined,
    email_verified: row.emailVerified ?? undefined,
    iat: row.iat ?? undefined,
    iss: row.iss ?? undefined,
    picture: row.picture ?? undefined,
    rat: row.rat ?? undefined,
    username: row.username ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Translate the snake_case domain keys present on the upsert input to Prisma
// camelCase columns. Only keys that are own-enumerable on `input` are
// touched — callers omit a field to leave it unchanged, or pass `undefined`
// to clear it.
function buildUpdateData(input: OAuthUserUpsertInput): Prisma.OAuthUserUpdateInput {
  const data: Prisma.OAuthUserUpdateInput = {};
  for (const key of Object.keys(input) as (keyof OAuthUserUpsertInput)[]) {
    const value = input[key];
    switch (key) {
      case 'aud':
        data.aud = { set: (value as string[] | undefined) ?? [] };
        break;
      case 'auth_time':
        data.authTime = (value as number | undefined) ?? null;
        break;
      case 'email':
        data.email = (value as string | undefined) ?? null;
        break;
      case 'email_verified':
        data.emailVerified = (value as boolean | undefined) ?? null;
        break;
      case 'iat':
        data.iat = (value as number | undefined) ?? null;
        break;
      case 'iss':
        data.iss = (value as string | undefined) ?? null;
        break;
      case 'picture':
        data.picture = (value as string | undefined) ?? null;
        break;
      case 'rat':
        data.rat = (value as number | undefined) ?? null;
        break;
      case 'username':
        data.username = (value as string | undefined) ?? null;
        break;
    }
  }
  return data;
}

function buildCreateData(
  provider: OAuthProvider,
  sub: string,
  input: OAuthUserUpsertInput,
): Prisma.OAuthUserCreateInput {
  return {
    provider: toPrismaProvider(provider),
    sub,
    aud: input.aud ?? [],
    authTime: input.auth_time ?? null,
    email: input.email ?? null,
    emailVerified: input.email_verified ?? null,
    iat: input.iat ?? null,
    iss: input.iss ?? null,
    picture: input.picture ?? null,
    rat: input.rat ?? null,
    username: input.username ?? null,
  };
}

@Injectable()
export class OAuthUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertBySub(provider: OAuthProvider, sub: string, update: OAuthUserUpsertInput): Promise<OAuthUserRow> {
    const prismaProvider = toPrismaProvider(provider);
    const row = await this.prisma.oAuthUser.upsert({
      where: { provider_sub: { provider: prismaProvider, sub } },
      update: buildUpdateData(update),
      create: buildCreateData(provider, sub, update),
    });
    return mapRow(row);
  }

  async findById(id: string): Promise<OAuthUserRow | null> {
    const row = await this.prisma.oAuthUser.findUnique({ where: { id } });
    return row ? mapRow(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<OAuthUserRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.oAuthUser.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(mapRow);
  }

  async findByProviderEmail(provider: OAuthProvider, email: string): Promise<OAuthUserRow | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return null;

    const row = await this.prisma.oAuthUser.findFirst({
      where: { provider: toPrismaProvider(provider), email: normalizedEmail },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? mapRow(row) : null;
  }
}

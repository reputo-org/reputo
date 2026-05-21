import { Injectable } from '@nestjs/common';
import type { OAuthConsentGrant as PrismaOAuthConsentGrant } from '@prisma/client';
import type { OAuthProvider } from '@reputo/database';
import { PrismaService } from '../persistence';
import { toPrismaProvider, toWireProvider } from '../shared/utils';

// Domain shape returned by the repository. Mirrors the former Mongoose
// `lean()` payload — `_id` instead of Prisma `id` so callers above the
// repository keep their existing field names.
export interface OAuthConsentGrantRow {
  _id: string;
  provider: OAuthProvider;
  source: string;
  state: string;
  codeVerifier: string;
  expiresAt: Date;
}

export interface OAuthConsentGrantCreateInput {
  provider: OAuthProvider;
  source: string;
  state: string;
  codeVerifier: string;
  expiresAt: Date;
}

function mapRow(row: PrismaOAuthConsentGrant): OAuthConsentGrantRow {
  return {
    _id: row.id,
    provider: toWireProvider(row.provider),
    source: row.source,
    state: row.state,
    codeVerifier: row.codeVerifier,
    expiresAt: row.expiresAt,
  };
}

@Injectable()
export class OAuthConsentGrantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: OAuthConsentGrantCreateInput): Promise<void> {
    await this.prisma.oAuthConsentGrant.create({
      data: {
        provider: toPrismaProvider(data.provider),
        source: data.source,
        state: data.state,
        codeVerifier: data.codeVerifier,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findActiveByProviderAndState(provider: OAuthProvider, state: string): Promise<OAuthConsentGrantRow | null> {
    const row = await this.prisma.oAuthConsentGrant.findFirst({
      where: {
        provider: toPrismaProvider(provider),
        state,
        expiresAt: { gt: new Date() },
      },
    });
    return row ? mapRow(row) : null;
  }

  async deleteByProviderAndState(provider: OAuthProvider, state: string): Promise<boolean> {
    const result = await this.prisma.oAuthConsentGrant.deleteMany({
      where: { provider: toPrismaProvider(provider), state },
    });
    return result.count > 0;
  }
}

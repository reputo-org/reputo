import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { OAuthProvider } from '@reputo/contracts';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { OAuthConsentGrantEntity } from '../persistence';

// Domain shape returned by the repository. Uses `_id` (rather than TypeORM's
// `id`) to match the field name callers above the repository expect.
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

function mapRow(entity: OAuthConsentGrantEntity): OAuthConsentGrantRow {
  return {
    _id: entity.id,
    provider: entity.provider,
    source: entity.source,
    state: entity.state,
    codeVerifier: entity.codeVerifier,
    expiresAt: entity.expiresAt,
  };
}

@Injectable()
export class OAuthConsentGrantRepository {
  constructor(
    @InjectRepository(OAuthConsentGrantEntity)
    private readonly repo: Repository<OAuthConsentGrantEntity>,
  ) {}

  async create(data: OAuthConsentGrantCreateInput): Promise<void> {
    const entity = this.repo.create({
      provider: data.provider,
      source: data.source,
      state: data.state,
      codeVerifier: data.codeVerifier,
      expiresAt: data.expiresAt,
    });
    await this.repo.save(entity);
  }

  async findActiveByProviderAndState(provider: OAuthProvider, state: string): Promise<OAuthConsentGrantRow | null> {
    const entity = await this.repo.findOne({
      where: {
        provider,
        state,
        expiresAt: MoreThan(new Date()),
      },
    });
    return entity ? mapRow(entity) : null;
  }

  async deleteByProviderAndState(provider: OAuthProvider, state: string): Promise<boolean> {
    const result = await this.repo.delete({ provider, state });
    return (result.affected ?? 0) > 0;
  }

  async deleteExpired(now = new Date()): Promise<{ deletedCount: number }> {
    const result = await this.repo.delete({ expiresAt: LessThan(now) });
    return { deletedCount: result.affected ?? 0 };
  }
}

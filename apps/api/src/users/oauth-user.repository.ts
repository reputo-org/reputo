import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { OAuthProvider } from '@reputo/contracts';
import { In, Repository } from 'typeorm';
import { OAuthUserEntity } from '../persistence';

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

function mapRow(entity: OAuthUserEntity): OAuthUserRow {
  return {
    _id: entity.id,
    provider: entity.provider,
    sub: entity.sub,
    aud: entity.aud.length > 0 ? entity.aud : undefined,
    auth_time: entity.authTime ?? undefined,
    email: entity.email ?? undefined,
    email_verified: entity.emailVerified ?? undefined,
    iat: entity.iat ?? undefined,
    iss: entity.iss ?? undefined,
    picture: entity.picture ?? undefined,
    rat: entity.rat ?? undefined,
    username: entity.username ?? undefined,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function applyUpdate(entity: OAuthUserEntity, input: OAuthUserUpsertInput): void {
  for (const key of Object.keys(input) as (keyof OAuthUserUpsertInput)[]) {
    const value = input[key];
    switch (key) {
      case 'aud':
        entity.aud = (value as string[] | undefined) ?? [];
        break;
      case 'auth_time':
        entity.authTime = (value as number | undefined) ?? null;
        break;
      case 'email':
        entity.email = (value as string | undefined) ?? null;
        break;
      case 'email_verified':
        entity.emailVerified = (value as boolean | undefined) ?? null;
        break;
      case 'iat':
        entity.iat = (value as number | undefined) ?? null;
        break;
      case 'iss':
        entity.iss = (value as string | undefined) ?? null;
        break;
      case 'picture':
        entity.picture = (value as string | undefined) ?? null;
        break;
      case 'rat':
        entity.rat = (value as number | undefined) ?? null;
        break;
      case 'username':
        entity.username = (value as string | undefined) ?? null;
        break;
    }
  }
}

function newEntity(provider: OAuthProvider, sub: string, input: OAuthUserUpsertInput): OAuthUserEntity {
  const entity = new OAuthUserEntity();
  entity.provider = provider;
  entity.sub = sub;
  entity.aud = input.aud ?? [];
  entity.authTime = input.auth_time ?? null;
  entity.email = input.email ?? null;
  entity.emailVerified = input.email_verified ?? null;
  entity.iat = input.iat ?? null;
  entity.iss = input.iss ?? null;
  entity.picture = input.picture ?? null;
  entity.rat = input.rat ?? null;
  entity.username = input.username ?? null;
  return entity;
}

@Injectable()
export class OAuthUserRepository {
  constructor(
    @InjectRepository(OAuthUserEntity)
    private readonly repo: Repository<OAuthUserEntity>,
  ) {}

  async upsertBySub(provider: OAuthProvider, sub: string, update: OAuthUserUpsertInput): Promise<OAuthUserRow> {
    return this.repo.manager.transaction(async (manager) => {
      const txRepo = manager.getRepository(OAuthUserEntity);
      const existing = await txRepo.findOne({ where: { provider, sub } });
      if (existing) {
        applyUpdate(existing, update);
        const saved = await txRepo.save(existing);
        return mapRow(saved);
      }
      const saved = await txRepo.save(newEntity(provider, sub, update));
      return mapRow(saved);
    });
  }

  async findById(id: string): Promise<OAuthUserRow | null> {
    const entity = await this.repo.findOne({ where: { id } });
    return entity ? mapRow(entity) : null;
  }

  async findByIds(ids: readonly string[]): Promise<OAuthUserRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.repo.find({ where: { id: In([...ids]) } });
    return rows.map(mapRow);
  }

  async findByProviderEmail(provider: OAuthProvider, email: string): Promise<OAuthUserRow | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return null;

    const entity = await this.repo.findOne({
      where: { provider, email: normalizedEmail },
      order: { updatedAt: 'DESC' },
    });
    return entity ? mapRow(entity) : null;
  }
}

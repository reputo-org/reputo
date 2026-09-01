import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CommunityConnectionStatus, type CommunityPlatform } from '@reputo/contracts';
import { QueryFailedError, Repository } from 'typeorm';
import { CommunityConnectionEntity } from '../persistence';

export interface CommunityConnectionRow {
  id: string;
  platform: CommunityPlatform;
  externalId: string;
  name: string;
  status: CommunityConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCommunityConnectionInput {
  platform: CommunityPlatform;
  externalId: string;
  name: string;
  status: CommunityConnectionStatus;
  credentialsCiphertext?: string;
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505';
}

function mapRow(entity: CommunityConnectionEntity): CommunityConnectionRow {
  return {
    id: entity.id,
    platform: entity.platform,
    externalId: entity.externalId,
    name: entity.name,
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

@Injectable()
export class CommunityConnectionRepository {
  constructor(
    @InjectRepository(CommunityConnectionEntity)
    private readonly connections: Repository<CommunityConnectionEntity>,
  ) {}

  async findAll(): Promise<CommunityConnectionRow[]> {
    const entities = await this.connections.find({ order: { createdAt: 'DESC' } });
    return entities.map(mapRow);
  }

  async findById(id: string): Promise<CommunityConnectionRow | null> {
    const entity = await this.connections.findOne({ where: { id } });
    return entity ? mapRow(entity) : null;
  }

  /**
   * Installs are idempotent per community: reconnecting the same guild revives
   * the existing row — including one an admin had disconnected — keeping its id
   * instead of creating a second connection for it.
   */
  async upsertFromInstall(input: UpsertCommunityConnectionInput): Promise<CommunityConnectionRow> {
    const existing = await this.findByExternalId(input);
    if (existing) {
      return mapRow(await this.connections.save(this.applyInstall(existing, input)));
    }

    try {
      return mapRow(await this.connections.save(this.applyInstall(undefined, input)));
    } catch (error) {
      // Another install of the same community won the unique index; adopt its row.
      if (!isDuplicateKeyError(error)) throw error;

      const winner = await this.findByExternalId(input);
      if (!winner) throw error;
      return mapRow(await this.connections.save(this.applyInstall(winner, input)));
    }
  }

  async updateStatus(id: string, status: CommunityConnectionStatus): Promise<CommunityConnectionRow | null> {
    const entity = await this.connections.findOne({ where: { id } });
    if (!entity) return null;

    entity.status = status;
    return mapRow(await this.connections.save(entity));
  }

  /**
   * Removes the connection outright. Audit rows survive with a null connection
   * link, so the record of who connected and disconnected it is not lost.
   */
  async deleteById(id: string): Promise<boolean> {
    const result = await this.connections.delete({ id });
    return Boolean(result.affected);
  }

  /**
   * The sealed credential of one connection, exposed on its own so credentials
   * never travel inside the row object the rest of the domain passes around.
   */
  async findCredentialsCiphertext(platform: CommunityPlatform, externalId: string): Promise<string | null> {
    const entity = await this.connections.findOne({
      where: { platform, externalId },
      select: { id: true, credentialsCiphertext: true },
    });
    return entity?.credentialsCiphertext ?? null;
  }

  private findByExternalId(input: UpsertCommunityConnectionInput): Promise<CommunityConnectionEntity | null> {
    return this.connections.findOne({ where: { platform: input.platform, externalId: input.externalId } });
  }

  /** A fresh install always replaces any credential the previous one left behind. */
  private applyInstall(
    entity: CommunityConnectionEntity | undefined,
    input: UpsertCommunityConnectionInput,
  ): CommunityConnectionEntity {
    const target = entity ?? new CommunityConnectionEntity();

    target.platform = input.platform;
    target.externalId = input.externalId;
    target.name = input.name;
    target.status = input.status;
    target.credentialsCiphertext = input.credentialsCiphertext ?? null;

    return target;
  }
}

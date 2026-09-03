import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  type CommunityConnectionMetadataDto,
  CommunityConnectionStatus,
  type CommunityPlatform,
} from '@reputo/contracts';
import { QueryFailedError, Repository } from 'typeorm';
import { CommunityConnectionEntity } from '../persistence';

export interface CommunityConnectionRow {
  id: string;
  platform: CommunityPlatform;
  externalId: string;
  name: string;
  status: CommunityConnectionStatus;
  metadata?: CommunityConnectionMetadataDto;
  /** When the platform last answered a check of this connection. */
  lastCheckedAt?: Date;
  /** Safe category of the last failed check; absent after a passing one. */
  lastFailureCategory?: string;
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

/** What one platform check established, to be written on the row. */
export interface RecordCheckInput {
  status: CommunityConnectionStatus;
  checkedAt: Date;
  /** Present for a failed check; a passing check clears it. */
  failureCategory?: string;
  /** Written only by a passing probe, so a failing one keeps the last good facts. */
  metadata?: CommunityConnectionMetadataDto;
  /** Fingerprint of the probe's resource listing and access verdicts. */
  resourcesDigest?: string;
}

/** The `settings` jsonb, as this repository lays it out. Untyped at rest; anything malformed reads as absent. */
interface StoredSettings {
  metadata?: unknown;
  resourcesDigest?: unknown;
  lastCheck?: unknown;
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505';
}

function readSettings(settings: unknown): StoredSettings {
  return typeof settings === 'object' && settings !== null ? (settings as StoredSettings) : {};
}

function readStoredMetadata(settings: StoredSettings): CommunityConnectionMetadataDto | undefined {
  const metadata = settings.metadata;
  if (typeof metadata !== 'object' || metadata === null) return undefined;

  const { avatarUrl, memberCount, resourceCount, readableResourceCount } = metadata as Record<string, unknown>;
  return {
    avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : undefined,
    memberCount: typeof memberCount === 'number' ? memberCount : undefined,
    resourceCount: typeof resourceCount === 'number' ? resourceCount : undefined,
    readableResourceCount: typeof readableResourceCount === 'number' ? readableResourceCount : undefined,
  };
}

function readLastCheck(
  settings: StoredSettings,
): Pick<CommunityConnectionRow, 'lastCheckedAt' | 'lastFailureCategory'> {
  const lastCheck = settings.lastCheck;
  if (typeof lastCheck !== 'object' || lastCheck === null) return {};

  const { at, category } = lastCheck as Record<string, unknown>;
  const checkedAt = typeof at === 'string' ? new Date(at) : undefined;
  return {
    lastCheckedAt: checkedAt !== undefined && !Number.isNaN(checkedAt.getTime()) ? checkedAt : undefined,
    lastFailureCategory: typeof category === 'string' && category.length > 0 ? category : undefined,
  };
}

function mapRow(entity: CommunityConnectionEntity): CommunityConnectionRow {
  const settings = readSettings(entity.settings);
  return {
    id: entity.id,
    platform: entity.platform,
    externalId: entity.externalId,
    name: entity.name,
    status: entity.status,
    metadata: readStoredMetadata(settings),
    ...readLastCheck(settings),
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

  /**
   * Writes the outcome of one platform check: the status it implies, when the
   * platform answered, and the failure category or the fresh probe facts. The
   * row is the single source of the connection's freshness and reason; a
   * failing check moves the status without wiping the last good metadata.
   */
  async recordCheck(id: string, input: RecordCheckInput): Promise<CommunityConnectionRow | null> {
    const entity = await this.connections.findOne({ where: { id } });
    if (!entity) return null;

    const settings = readSettings(entity.settings);
    entity.status = input.status;
    entity.settings = {
      ...settings,
      ...(input.metadata !== undefined && { metadata: input.metadata }),
      ...(input.resourcesDigest !== undefined && { resourcesDigest: input.resourcesDigest }),
      lastCheck: { at: input.checkedAt.toISOString(), category: input.failureCategory ?? null },
    };
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

  /** Same, addressed by connection id — the handle the snapshot activities carry. */
  async findCredentialsCiphertextById(id: string): Promise<string | null> {
    const entity = await this.connections.findOne({
      where: { id },
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

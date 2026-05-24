import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ACCESS_ROLE_ADMIN, type AccessRole, type OAuthProvider } from '@reputo/contracts';
import {
  type FindOptionsOrder,
  type FindOptionsWhere,
  ILike,
  In,
  IsNull,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { AccessAllowlistEntity } from '../persistence';
import type { AdminAllowlistSortField, AdminAllowlistSortOrder, AdminAllowlistStatus } from './admin.constants';

export interface AccessAllowlistRow {
  _id: string;
  provider: OAuthProvider;
  email: string;
  role: AccessRole;
  invitedBy: string | null;
  invitedAt: Date;
  revokedAt?: Date;
  revokedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAllowlistListFilters {
  provider?: OAuthProvider | OAuthProvider[];
  role?: AccessRole | AccessRole[];
  status?: AdminAllowlistStatus;
  q?: string;
}

export interface AdminAllowlistListOptions extends AdminAllowlistListFilters {
  page?: number;
  limit?: number;
  sortField?: AdminAllowlistSortField;
  sortOrder?: AdminAllowlistSortOrder;
}

export interface AdminAllowlistListResult {
  results: AccessAllowlistRow[];
  total: number;
}

function mapRow(entity: AccessAllowlistEntity): AccessAllowlistRow {
  return {
    _id: entity.id,
    provider: entity.provider,
    email: entity.email,
    role: entity.role,
    invitedBy: entity.invitedByUserId,
    invitedAt: entity.invitedAt,
    revokedAt: entity.revokedAt ?? undefined,
    revokedBy: entity.revokedByUserId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

@Injectable()
export class AdminAllowlistRepository {
  constructor(
    @InjectRepository(AccessAllowlistEntity)
    private readonly repo: Repository<AccessAllowlistEntity>,
  ) {}

  async findActiveByProviderEmail(provider: OAuthProvider, email: string): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const entity = await this.repo.findOne({
      where: { provider, email: normalizedEmail, revokedAt: IsNull() },
    });
    return entity ? mapRow(entity) : null;
  }

  async findByProviderEmail(provider: OAuthProvider, email: string): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const entity = await this.repo.findOne({
      where: { provider, email: normalizedEmail },
    });
    return entity ? mapRow(entity) : null;
  }

  async countActiveOwners(provider: OAuthProvider): Promise<number> {
    return this.repo.count({ where: { provider, role: 'owner', revokedAt: IsNull() } });
  }

  async list(options: AdminAllowlistListOptions): Promise<AdminAllowlistListResult> {
    const where = this.buildWhere(options);
    const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100);
    const page = Math.max(Number(options.page ?? 1), 1);
    const skip = (page - 1) * limit;
    const sortField: AdminAllowlistSortField = options.sortField ?? 'email';
    const sortOrder: 'ASC' | 'DESC' = options.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const sortFallback: AdminAllowlistSortField = 'email';

    const order: FindOptionsOrder<AccessAllowlistEntity> = { [sortField]: sortOrder };
    if (sortField !== sortFallback) {
      order[sortFallback] = 'ASC';
    }

    const [rows, total] = await this.repo.findAndCount({ where, order, skip, take: limit });

    return { results: rows.map(mapRow), total };
  }

  async createAdmin(
    provider: OAuthProvider,
    email: string,
    role: AccessRole,
    actorId: string | null,
    invitedAt = new Date(),
  ): Promise<AccessAllowlistRow> {
    const entity = this.repo.create({
      provider,
      email: this.normalizeEmail(email),
      role,
      invitedByUserId: actorId,
      invitedAt,
      revokedAt: null,
      revokedByUserId: null,
    });
    const saved = await this.repo.save(entity);
    return mapRow(saved);
  }

  async restore(
    provider: OAuthProvider,
    email: string,
    actorId: string | null,
    options: { invitedAt?: Date; role?: AccessRole } = {},
  ): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const invitedAt = options.invitedAt ?? new Date();
    const role: AccessRole = options.role ?? ACCESS_ROLE_ADMIN;

    const result = await this.repo.update(
      { provider, email: normalizedEmail, revokedAt: Not(IsNull()) },
      { invitedByUserId: actorId, invitedAt, role, revokedAt: null, revokedByUserId: null },
    );
    if (!result.affected) return null;

    const updated = await this.repo.findOne({ where: { provider, email: normalizedEmail } });
    return updated ? mapRow(updated) : null;
  }

  async updateRole(provider: OAuthProvider, email: string, role: AccessRole): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const result = await this.repo.update({ provider, email: normalizedEmail, revokedAt: IsNull() }, { role });
    if (!result.affected) return null;

    const updated = await this.repo.findOne({ where: { provider, email: normalizedEmail } });
    return updated ? mapRow(updated) : null;
  }

  async softRevoke(
    provider: OAuthProvider,
    email: string,
    actorId: string,
    revokedAt = new Date(),
  ): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const result = await this.repo.update(
      { provider, email: normalizedEmail, revokedAt: IsNull() },
      { revokedAt, revokedByUserId: actorId },
    );
    if (!result.affected) return null;

    const updated = await this.repo.findOne({ where: { provider, email: normalizedEmail } });
    return updated ? mapRow(updated) : null;
  }

  isDuplicateKeyError(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as { code?: string })?.code;
      return code === '23505';
    }
    return false;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private buildWhere(options: AdminAllowlistListFilters): FindOptionsWhere<AccessAllowlistEntity> {
    const where: FindOptionsWhere<AccessAllowlistEntity> = {};

    if (options.provider) {
      where.provider = Array.isArray(options.provider) ? In(options.provider) : options.provider;
    }

    if (options.role) {
      where.role = Array.isArray(options.role) ? In(options.role) : options.role;
    }

    const status: AdminAllowlistStatus = options.status ?? 'active';
    if (status === 'active') {
      where.revokedAt = IsNull();
    } else if (status === 'revoked') {
      where.revokedAt = Not(IsNull());
    }

    if (options.q) {
      const trimmed = options.q.trim().toLowerCase();
      if (trimmed) {
        where.email = ILike(`${trimmed}%`);
      }
    }

    return where;
  }
}

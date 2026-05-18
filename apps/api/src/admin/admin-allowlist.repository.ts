import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ACCESS_ROLE_ADMIN,
  ACCESS_ROLE_OWNER,
  type AccessAllowlist,
  type AccessAllowlistWithId,
  type AccessRole,
  MODEL_NAMES,
  type OAuthProvider,
} from '@reputo/database';
import type { FilterQuery, Model, Types } from 'mongoose';
import type { AdminAllowlistSortField, AdminAllowlistSortOrder, AdminAllowlistStatus } from './admin.constants';

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
  results: AccessAllowlistWithId[];
  total: number;
}

@Injectable()
export class AdminAllowlistRepository {
  constructor(
    @InjectModel(MODEL_NAMES.ACCESS_ALLOWLIST)
    private readonly model: Model<AccessAllowlist>,
  ) {}

  async findActiveByProviderEmail(provider: OAuthProvider, email: string): Promise<AccessAllowlistWithId | null> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      return null;
    }

    return (await this.model
      .findOne({ provider, email: normalizedEmail, revokedAt: null })
      .lean()
      .exec()) as AccessAllowlistWithId | null;
  }

  async findByProviderEmail(provider: OAuthProvider, email: string): Promise<AccessAllowlistWithId | null> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      return null;
    }

    return (await this.model
      .findOne({ provider, email: normalizedEmail })
      .lean()
      .exec()) as AccessAllowlistWithId | null;
  }

  async countActiveOwners(provider: OAuthProvider): Promise<number> {
    return this.model.countDocuments({ provider, role: ACCESS_ROLE_OWNER, revokedAt: null }).exec();
  }

  async list(options: AdminAllowlistListOptions): Promise<AdminAllowlistListResult> {
    const filter = this.buildFilter(options);
    const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100);
    const page = Math.max(Number(options.page ?? 1), 1);
    const skip = (page - 1) * limit;
    const sortField: AdminAllowlistSortField = options.sortField ?? 'email';
    const sortOrder: 1 | -1 = options.sortOrder === 'desc' ? -1 : 1;
    const sortFallback: AdminAllowlistSortField = 'email';
    const sort: Record<string, 1 | -1> =
      sortField === sortFallback ? { [sortField]: sortOrder } : { [sortField]: sortOrder, [sortFallback]: 1 };

    const [results, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(skip).limit(limit).lean().exec() as Promise<AccessAllowlistWithId[]>,
      this.model.countDocuments(filter).exec(),
    ]);

    return { results, total };
  }

  async createAdmin(
    provider: OAuthProvider,
    email: string,
    role: AccessRole,
    actorId: Types.ObjectId | string | null,
    invitedAt = new Date(),
  ): Promise<AccessAllowlistWithId> {
    const created = await this.model.create({
      provider,
      email: this.normalizeEmail(email),
      role,
      invitedBy: actorId,
      invitedAt,
    } satisfies AccessAllowlist);

    return created.toObject() as AccessAllowlistWithId;
  }

  async restore(
    provider: OAuthProvider,
    email: string,
    actorId: Types.ObjectId | string | null,
    options: { invitedAt?: Date; role?: AccessRole } = {},
  ): Promise<AccessAllowlistWithId | null> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      return null;
    }

    const invitedAt = options.invitedAt ?? new Date();
    const role: AccessRole = options.role ?? ACCESS_ROLE_ADMIN;

    return (await this.model
      .findOneAndUpdate(
        { provider, email: normalizedEmail, revokedAt: { $exists: true, $ne: null } },
        {
          $set: { invitedBy: actorId, invitedAt, role },
          $unset: { revokedAt: '', revokedBy: '' },
        },
        { lean: true, new: true },
      )
      .exec()) as AccessAllowlistWithId | null;
  }

  async updateRole(provider: OAuthProvider, email: string, role: AccessRole): Promise<AccessAllowlistWithId | null> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      return null;
    }

    return (await this.model
      .findOneAndUpdate(
        { provider, email: normalizedEmail, revokedAt: null },
        { $set: { role } },
        { lean: true, new: true },
      )
      .exec()) as AccessAllowlistWithId | null;
  }

  async softRevoke(
    provider: OAuthProvider,
    email: string,
    actorId: Types.ObjectId | string,
    revokedAt = new Date(),
  ): Promise<AccessAllowlistWithId | null> {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      return null;
    }

    return (await this.model
      .findOneAndUpdate(
        { provider, email: normalizedEmail, revokedAt: null },
        { $set: { revokedAt, revokedBy: actorId } },
        { lean: true, new: true },
      )
      .exec()) as AccessAllowlistWithId | null;
  }

  isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 11000
    );
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private buildFilter(options: AdminAllowlistListFilters): FilterQuery<AccessAllowlist> {
    const filter: FilterQuery<AccessAllowlist> = {};

    if (options.provider) {
      filter.provider = Array.isArray(options.provider) ? { $in: options.provider } : options.provider;
    }

    if (options.role) {
      filter.role = Array.isArray(options.role) ? { $in: options.role } : options.role;
    }

    const status: AdminAllowlistStatus = options.status ?? 'active';
    if (status === 'active') {
      filter.revokedAt = null;
    } else if (status === 'revoked') {
      filter.revokedAt = { $exists: true, $ne: null };
    }

    if (options.q) {
      const trimmed = options.q.trim().toLowerCase();
      if (trimmed) {
        filter.email = { $regex: `^${escapeRegex(trimmed)}` };
      }
    }

    return filter;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

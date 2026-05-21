import { Injectable } from '@nestjs/common';
import { Prisma, type AccessAllowlist as PrismaAccessAllowlist } from '@prisma/client';
import { ACCESS_ROLE_ADMIN, type AccessRole, type OAuthProvider } from '@reputo/database';
import { PrismaService } from '../persistence';
import { toPrismaProvider, toWireProvider } from '../shared/utils';
import type { AdminAllowlistSortField, AdminAllowlistSortOrder, AdminAllowlistStatus } from './admin.constants';

// Domain shape returned by the repository. Mirrors the former Mongoose
// `lean()` payload — `_id` instead of Prisma `id` so callers above the
// repository keep using `_id` and string-shaped invitedBy/revokedBy fields.
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

function mapRow(row: PrismaAccessAllowlist): AccessAllowlistRow {
  return {
    _id: row.id,
    provider: toWireProvider(row.provider),
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy,
    invitedAt: row.invitedAt,
    // Drop `revokedAt` from the row when null so the response shape matches
    // the previous Mongoose `lean()` output (the field is omitted, not
    // explicitly null).
    revokedAt: row.revokedAt ?? undefined,
    revokedBy: row.revokedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class AdminAllowlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByProviderEmail(provider: OAuthProvider, email: string): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const row = await this.prisma.accessAllowlist.findFirst({
      where: { provider: toPrismaProvider(provider), email: normalizedEmail, revokedAt: null },
    });
    return row ? mapRow(row) : null;
  }

  async findByProviderEmail(provider: OAuthProvider, email: string): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const row = await this.prisma.accessAllowlist.findUnique({
      where: { provider_email: { provider: toPrismaProvider(provider), email: normalizedEmail } },
    });
    return row ? mapRow(row) : null;
  }

  async countActiveOwners(provider: OAuthProvider): Promise<number> {
    return this.prisma.accessAllowlist.count({
      where: { provider: toPrismaProvider(provider), role: 'owner', revokedAt: null },
    });
  }

  async list(options: AdminAllowlistListOptions): Promise<AdminAllowlistListResult> {
    const where = this.buildWhere(options);
    const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100);
    const page = Math.max(Number(options.page ?? 1), 1);
    const skip = (page - 1) * limit;
    const sortField: AdminAllowlistSortField = options.sortField ?? 'email';
    const sortOrder: 'asc' | 'desc' = options.sortOrder === 'desc' ? 'desc' : 'asc';
    const sortFallback: AdminAllowlistSortField = 'email';
    const orderBy: Prisma.AccessAllowlistOrderByWithRelationInput[] =
      sortField === sortFallback
        ? [{ [sortField]: sortOrder } as Prisma.AccessAllowlistOrderByWithRelationInput]
        : [
            { [sortField]: sortOrder } as Prisma.AccessAllowlistOrderByWithRelationInput,
            { [sortFallback]: 'asc' } as Prisma.AccessAllowlistOrderByWithRelationInput,
          ];

    const [rows, total] = await Promise.all([
      this.prisma.accessAllowlist.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.accessAllowlist.count({ where }),
    ]);

    return { results: rows.map(mapRow), total };
  }

  async createAdmin(
    provider: OAuthProvider,
    email: string,
    role: AccessRole,
    actorId: string | null,
    invitedAt = new Date(),
  ): Promise<AccessAllowlistRow> {
    const created = await this.prisma.accessAllowlist.create({
      data: {
        provider: toPrismaProvider(provider),
        email: this.normalizeEmail(email),
        role,
        invitedBy: actorId,
        invitedAt,
      },
    });
    return mapRow(created);
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

    // Two-step update preserves the Mongoose `findOneAndUpdate` semantics that
    // returned null when the row existed but wasn't revoked. Prisma's compound
    // `where` on `update` requires a single, all-or-nothing match.
    const result = await this.prisma.accessAllowlist.updateMany({
      where: { provider: toPrismaProvider(provider), email: normalizedEmail, revokedAt: { not: null } },
      data: { invitedBy: actorId, invitedAt, role, revokedAt: null, revokedBy: null },
    });
    if (result.count === 0) return null;

    const updated = await this.prisma.accessAllowlist.findUnique({
      where: { provider_email: { provider: toPrismaProvider(provider), email: normalizedEmail } },
    });
    return updated ? mapRow(updated) : null;
  }

  async updateRole(provider: OAuthProvider, email: string, role: AccessRole): Promise<AccessAllowlistRow | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    const result = await this.prisma.accessAllowlist.updateMany({
      where: { provider: toPrismaProvider(provider), email: normalizedEmail, revokedAt: null },
      data: { role },
    });
    if (result.count === 0) return null;

    const updated = await this.prisma.accessAllowlist.findUnique({
      where: { provider_email: { provider: toPrismaProvider(provider), email: normalizedEmail } },
    });
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

    const result = await this.prisma.accessAllowlist.updateMany({
      where: { provider: toPrismaProvider(provider), email: normalizedEmail, revokedAt: null },
      data: { revokedAt, revokedBy: actorId },
    });
    if (result.count === 0) return null;

    const updated = await this.prisma.accessAllowlist.findUnique({
      where: { provider_email: { provider: toPrismaProvider(provider), email: normalizedEmail } },
    });
    return updated ? mapRow(updated) : null;
  }

  // Prisma `P2002` is the unique-constraint violation, the direct
  // counterpart of Mongo's `11000` duplicate-key error.
  isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002'
    );
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private buildWhere(options: AdminAllowlistListFilters): Prisma.AccessAllowlistWhereInput {
    const where: Prisma.AccessAllowlistWhereInput = {};

    if (options.provider) {
      where.provider = Array.isArray(options.provider)
        ? { in: options.provider.map(toPrismaProvider) }
        : toPrismaProvider(options.provider);
    }

    if (options.role) {
      where.role = Array.isArray(options.role) ? { in: options.role } : options.role;
    }

    const status: AdminAllowlistStatus = options.status ?? 'active';
    if (status === 'active') {
      where.revokedAt = null;
    } else if (status === 'revoked') {
      where.revokedAt = { not: null };
    }

    if (options.q) {
      const trimmed = options.q.trim().toLowerCase();
      if (trimmed) {
        // Email is stored already-lowercased, so a case-sensitive prefix
        // match is equivalent to the Mongo regex `^foo` ignore-case search.
        where.email = { startsWith: trimmed };
      }
    }

    return where;
  }
}

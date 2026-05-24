import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_ROLE_ADMIN,
  ACCESS_ROLE_OWNER,
  type AccessRole,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  OAuthProviderDeepId,
} from '@reputo/contracts';
import { isEmail } from 'class-validator';
import { AuthSessionRepository, type UserSessionActivity } from '../sessions';
import { OAuthUserRepository, type OAuthUserRow } from '../users';
import { type AccessAllowlistRow, AdminAllowlistRepository } from './admin-allowlist.repository';
import type { AdminListResponseDto, AdminViewDto, ListAdminsQueryDto } from './dto';

export class OwnerEmailConflictError extends Error {
  constructor(
    readonly provider: OAuthProvider,
    readonly configuredOwnerEmail: string,
    readonly conflictingEmail: string,
  ) {
    super('OWNER_EMAIL conflicts with an active allowlist row.');
    this.name = OwnerEmailConflictError.name;
  }
}

type MutationAction = 'admin.add' | 'admin.remove' | 'admin.restore' | 'admin.role';

type ActivityByKey = ReadonlyMap<string, UserSessionActivity>;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly ownerEmail?: string;
  private readonly ownerProvider: OAuthProvider;

  constructor(
    private readonly adminAllowlistRepository: AdminAllowlistRepository,
    private readonly authSessionRepository: AuthSessionRepository,
    private readonly oauthUserRepository: OAuthUserRepository,
    configService: ConfigService,
  ) {
    this.ownerEmail = configService.get<string>('auth.ownerEmail')?.trim().toLowerCase() || undefined;
    this.ownerProvider = configService.get<OAuthProvider>('auth.ownerProvider') ?? OAuthProviderDeepId;
  }

  isAllowlisted(provider: OAuthProvider, email: string): Promise<AccessAllowlistRow | null> {
    return this.adminAllowlistRepository.findActiveByProviderEmail(provider, email);
  }

  async resolveRole(provider: OAuthProvider, email: string): Promise<AccessRole | null> {
    const row = await this.isAllowlisted(provider, email);

    return row?.role ?? null;
  }

  async list(query: ListAdminsQueryDto): Promise<AdminListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { results, total } = await this.adminAllowlistRepository.list({
      provider: query.provider,
      role: query.role,
      status: query.status ?? 'active',
      q: query.q,
      sortField: query.sortField ?? 'email',
      sortOrder: query.sortOrder ?? 'asc',
      page,
      limit,
    });

    const emailById = await this.resolveInviterAndRevokerEmails(results);
    const activityByKey = query.includeSessions ? await this.collectSessionActivity(results) : null;

    return {
      results: results.map((row) => this.toAdminView(row, emailById, activityByKey)),
      page,
      limit,
      totalResults: total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async addAdmin(
    actor: OAuthUserRow,
    input: { provider: OAuthProvider; email: string; role?: AccessRole },
  ): Promise<AdminViewDto> {
    const provider = this.requireProvider(input.provider);
    const targetEmail = this.normalizeEmailOrThrow(input.email);
    const targetRole: AccessRole = input.role ?? ACCESS_ROLE_ADMIN;

    const existing = await this.adminAllowlistRepository.findByProviderEmail(provider, targetEmail);

    if (existing && !existing.revokedAt) {
      this.logMutation(actor, 'admin.add', provider, targetEmail, 'active_conflict');
      throw new ConflictException('An active allowlist row already exists for this email.');
    }

    if (existing?.revokedAt) {
      this.logMutation(actor, 'admin.add', provider, targetEmail, 'restore_required');
      throw new ConflictException('A revoked allowlist row exists. Use the restore endpoint instead.');
    }

    try {
      const created = await this.adminAllowlistRepository.createAdmin(provider, targetEmail, targetRole, actor._id);
      this.logMutation(actor, 'admin.add', provider, targetEmail, 'created');

      return this.toAdminView(created, this.actorEmailMap(actor), null);
    } catch (error) {
      if (this.adminAllowlistRepository.isDuplicateKeyError(error)) {
        this.logMutation(actor, 'admin.add', provider, targetEmail, 'race_conflict');
        throw new ConflictException('An allowlist row already exists for this email. Refresh and try again.');
      }
      throw error;
    }
  }

  async restoreAdmin(actor: OAuthUserRow, input: { provider: OAuthProvider; email: string }): Promise<AdminViewDto> {
    const provider = this.requireProvider(input.provider);
    const targetEmail = this.normalizeEmailOrThrow(input.email);

    const restored = await this.adminAllowlistRepository.restore(provider, targetEmail, actor._id);

    if (!restored) {
      this.logMutation(actor, 'admin.restore', provider, targetEmail, 'not_found');
      throw new NotFoundException('No revoked allowlist row to restore.');
    }

    this.logMutation(actor, 'admin.restore', provider, targetEmail, 'restored');

    return this.toAdminView(restored, this.actorEmailMap(actor), null);
  }

  async updateRole(
    actor: OAuthUserRow,
    input: { provider: OAuthProvider; email: string; role: AccessRole },
  ): Promise<AdminViewDto> {
    const provider = this.requireProvider(input.provider);
    const targetEmail = this.normalizeEmailOrThrow(input.email);
    const actorEmail = actor.email ? this.normalizeEmail(actor.email) : undefined;

    const existing = await this.adminAllowlistRepository.findActiveByProviderEmail(provider, targetEmail);

    if (!existing) {
      this.logMutation(actor, 'admin.role', provider, targetEmail, 'not_found');
      throw new NotFoundException('Active allowlist row not found.');
    }

    if (existing.role === input.role) {
      return this.toAdminView(existing, await this.resolveActorEmailMap(actor, existing), null);
    }

    const isDemotion = existing.role === ACCESS_ROLE_OWNER && input.role !== ACCESS_ROLE_OWNER;

    if (isDemotion && actorEmail === targetEmail) {
      this.logMutation(actor, 'admin.role', provider, targetEmail, 'self_demote_blocked');
      throw new ForbiddenException('Owners cannot demote themselves.');
    }

    if (isDemotion) {
      const owners = await this.adminAllowlistRepository.countActiveOwners(provider);
      if (owners <= 1) {
        this.logMutation(actor, 'admin.role', provider, targetEmail, 'last_owner_blocked');
        throw new ForbiddenException('Cannot demote the last active owner.');
      }
    }

    const updated = await this.adminAllowlistRepository.updateRole(provider, targetEmail, input.role);

    if (!updated) {
      this.logMutation(actor, 'admin.role', provider, targetEmail, 'not_found');
      throw new NotFoundException('Active allowlist row not found.');
    }

    this.logMutation(actor, 'admin.role', provider, targetEmail, `set_${input.role}`);

    return this.toAdminView(updated, await this.resolveActorEmailMap(actor, updated), null);
  }

  async removeAdmin(actor: OAuthUserRow, input: { provider: OAuthProvider; email: string }): Promise<void> {
    const provider = this.requireProvider(input.provider);
    const targetEmail = this.normalizeEmailOrThrow(input.email);
    const actorEmail = actor.email ? this.normalizeEmail(actor.email) : undefined;

    if (actorEmail === targetEmail) {
      this.logMutation(actor, 'admin.remove', provider, targetEmail, 'self_protect');
      throw new ForbiddenException('You cannot remove yourself.');
    }

    const existing = await this.adminAllowlistRepository.findActiveByProviderEmail(provider, targetEmail);

    if (!existing) {
      this.logMutation(actor, 'admin.remove', provider, targetEmail, 'not_found');
      throw new NotFoundException('Active allowlist row not found.');
    }

    if (existing.role === ACCESS_ROLE_OWNER) {
      const owners = await this.adminAllowlistRepository.countActiveOwners(provider);
      if (owners <= 1) {
        this.logMutation(actor, 'admin.remove', provider, targetEmail, 'last_owner_blocked');
        throw new ForbiddenException('Cannot remove the last active owner.');
      }
    }

    const revokedRow = await this.adminAllowlistRepository.softRevoke(provider, targetEmail, actor._id);

    if (!revokedRow) {
      this.logMutation(actor, 'admin.remove', provider, targetEmail, 'not_found');
      throw new NotFoundException('Active allowlist row not found.');
    }

    const targetUser = await this.oauthUserRepository.findByProviderEmail(provider, targetEmail);
    const revokedSessions = targetUser ? await this.authSessionRepository.revokeAllByUserId(targetUser._id) : 0;

    this.logger.log({
      actor: this.toLogActor(actor),
      action: 'admin.remove',
      provider,
      targetEmail,
      targetUserId: targetUser ? String(targetUser._id) : undefined,
      outcome: 'revoked',
      revokedSessions,
    });
  }

  async seedOwner(): Promise<void> {
    if (!this.ownerEmail) {
      return;
    }

    const provider = this.ownerProvider;
    const existing = await this.adminAllowlistRepository.findByProviderEmail(provider, this.ownerEmail);

    if (existing && !existing.revokedAt) {
      if (existing.role === ACCESS_ROLE_OWNER) {
        return;
      }

      this.logger.fatal({
        provider,
        configuredOwnerEmail: this.ownerEmail,
        conflictingEmail: existing.email,
        conflictingRole: existing.role,
      });
      throw new OwnerEmailConflictError(provider, this.ownerEmail, existing.email);
    }

    if (existing?.revokedAt) {
      await this.adminAllowlistRepository.restore(provider, this.ownerEmail, null, { role: ACCESS_ROLE_OWNER });
      this.logger.log({ provider, action: 'admin.seed', outcome: 'restored_owner', email: this.ownerEmail });
      return;
    }

    await this.adminAllowlistRepository.createAdmin(provider, this.ownerEmail, ACCESS_ROLE_OWNER, null);
    this.logger.log({ provider, action: 'admin.seed', outcome: 'created_owner', email: this.ownerEmail });
  }

  private async resolveInviterAndRevokerEmails(
    rows: readonly AccessAllowlistRow[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.invitedBy) ids.add(row.invitedBy);
      if (row.revokedBy) ids.add(row.revokedBy);
    }

    if (ids.size === 0) return new Map();

    const users = await this.oauthUserRepository.findByIds([...ids]);
    const map = new Map<string, string>();
    for (const user of users) {
      if (user.email) map.set(String(user._id), this.normalizeEmail(user.email));
    }
    return map;
  }

  private async resolveActorEmailMap(actor: OAuthUserRow, row: AccessAllowlistRow): Promise<Map<string, string>> {
    const map = this.actorEmailMap(actor);
    const ids: string[] = [];
    if (row.invitedBy && !map.has(row.invitedBy)) ids.push(row.invitedBy);
    if (row.revokedBy && !map.has(row.revokedBy)) ids.push(row.revokedBy);

    if (ids.length === 0) return map;

    const users = await this.oauthUserRepository.findByIds(ids);
    for (const user of users) {
      if (user.email) map.set(String(user._id), this.normalizeEmail(user.email));
    }
    return map;
  }

  private actorEmailMap(actor: OAuthUserRow): Map<string, string> {
    const map = new Map<string, string>();
    if (actor.email) map.set(String(actor._id), this.normalizeEmail(actor.email));
    return map;
  }

  private async collectSessionActivity(rows: readonly AccessAllowlistRow[]): Promise<ActivityByKey> {
    const userLookups = await Promise.all(
      rows.map(async (row) => ({
        key: `${row.provider}:${row.email}`,
        user: await this.oauthUserRepository.findByProviderEmail(row.provider, row.email),
      })),
    );

    const userByKey = new Map(
      userLookups
        .filter((entry): entry is { key: string; user: OAuthUserRow } => entry.user !== null)
        .map(({ key, user }) => [key, user]),
    );

    const userIds = [...userByKey.values()].map((user) => user._id);
    const activityByUserId = await this.authSessionRepository.aggregateActivityByUserIds(userIds);

    const activityByKey = new Map<string, UserSessionActivity>();
    for (const [key, user] of userByKey.entries()) {
      activityByKey.set(key, activityByUserId.get(String(user._id)) ?? { lastSignInAt: null, activeSessionCount: 0 });
    }
    return activityByKey;
  }

  private toAdminView(
    row: AccessAllowlistRow,
    emailByUserId: ReadonlyMap<string, string>,
    activityByKey: ActivityByKey | null,
  ): AdminViewDto {
    const invitedByEmail = row.invitedBy ? emailByUserId.get(row.invitedBy) : undefined;
    const revokedByEmail = row.revokedBy ? emailByUserId.get(row.revokedBy) : undefined;
    const activity = activityByKey?.get(`${row.provider}:${row.email}`);

    const view: AdminViewDto = {
      provider: row.provider,
      email: row.email,
      role: row.role,
      invitedAt: row.invitedAt.toISOString(),
    };

    if (invitedByEmail) view.invitedByEmail = invitedByEmail;
    if (row.revokedAt) view.revokedAt = row.revokedAt.toISOString();
    if (revokedByEmail) view.revokedByEmail = revokedByEmail;

    if (activityByKey) {
      view.lastSignInAt = activity?.lastSignInAt ? activity.lastSignInAt.toISOString() : undefined;
      view.activeSessionCount = activity?.activeSessionCount ?? 0;
      view.hasEverSignedIn = Boolean(activity?.lastSignInAt);
    }

    return view;
  }

  private requireProvider(provider: OAuthProvider): OAuthProvider {
    if (!OAUTH_PROVIDERS.includes(provider)) {
      throw new BadRequestException(`Unknown provider: ${provider}`);
    }
    return provider;
  }

  private normalizeEmailOrThrow(email: string): string {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail || !isEmail(normalizedEmail)) {
      throw new BadRequestException('A valid email address is required.');
    }

    return normalizedEmail;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private toLogActor(actor: OAuthUserRow): { email?: string; id: string } {
    return {
      id: String(actor._id),
      ...(actor.email ? { email: this.normalizeEmail(actor.email) } : {}),
    };
  }

  private logMutation(
    actor: OAuthUserRow,
    action: MutationAction,
    provider: OAuthProvider,
    targetEmail: string,
    outcome: string,
  ): void {
    this.logger.log({ actor: this.toLogActor(actor), action, provider, targetEmail, outcome });
  }
}

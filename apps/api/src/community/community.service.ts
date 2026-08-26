import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type DiscordClient, toErrorCategory } from '@reputo/community-api';
import { CommunityConnectionStatus, CommunityPlatform } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { throwNotFoundError } from '../shared/exceptions';
import type { OAuthUserRow } from '../users';
import {
  CommunityAuditAction,
  type CommunityAuditErrorCategory,
  CommunityAuditOutcome,
  CommunityLocalErrorCategory,
  DISCORD_CLIENT,
  describeErrorCategory,
  statusForFailure,
} from './community.constants';
import {
  CommunityConnectionDisconnectedException,
  CommunityPlatformException,
  CommunityPlatformMismatchException,
} from './community.exceptions';
import { CommunityAuditRepository, type LatestVerification } from './community-audit.repository';
import { CommunityConnectionRepository, type CommunityConnectionRow } from './community-connection.repository';
import { CommunityInstallStateService } from './community-install-state.service';
import type { CommunityConnectionDto, CommunityHealthDto, CommunityResourceDto } from './dto';

const COMMUNITY_CONNECTION_ENTITY = 'CommunityConnection';

@Injectable()
export class CommunityService {
  private readonly connectionsPageUrl: string;

  constructor(
    @InjectPinoLogger(CommunityService.name)
    private readonly logger: PinoLogger,
    private readonly connections: CommunityConnectionRepository,
    private readonly audit: CommunityAuditRepository,
    private readonly installState: CommunityInstallStateService,
    @Inject(DISCORD_CLIENT)
    private readonly discord: DiscordClient,
    configService: ConfigService,
  ) {
    this.connectionsPageUrl = new URL('/community', configService.get<string>('auth.appPublicUrl')).toString();
  }

  async list(): Promise<CommunityConnectionDto[]> {
    const rows = await this.connections.findAll();
    const verifications = await this.audit.findLatestVerification(rows.map((row) => row.id));

    return rows.map((row) => this.toDto(row, verifications.get(row.id)));
  }

  /**
   * Install URL for a new community, or for reconnecting an existing one. A
   * reconnect locks the authorization screen to that community's guild, so an
   * admin fixing a broken connection cannot land on a different server.
   */
  async getDiscordInstallUrl(actor: OAuthUserRow, connectionId?: string): Promise<{ url: string }> {
    const connection = connectionId ? await this.getConnectionOrThrow(connectionId) : undefined;

    if (connection && connection.platform !== CommunityPlatform.discord) {
      throw new CommunityPlatformMismatchException(CommunityPlatform.discord, connection.platform);
    }

    const url = this.discord.buildInstallUrl(
      this.installState.issue(CommunityPlatform.discord),
      connection?.externalId,
    );

    await this.audit.record({
      connectionId: connection?.id,
      platform: CommunityPlatform.discord,
      actorUserId: actor._id,
      action: CommunityAuditAction.installUrl,
      outcome: CommunityAuditOutcome.success,
    });

    return { url };
  }

  /**
   * Completes a Discord bot install and returns where to send the browser.
   * The guild comes from the code exchange, never from the redirect query, so a
   * tampered callback cannot connect a community the admin did not authorize.
   */
  async handleDiscordCallback(
    actor: OAuthUserRow,
    query: { code?: string; state?: string; error?: string },
  ): Promise<string> {
    if (query.error) {
      return this.failCallback(actor, CommunityLocalErrorCategory.declined);
    }
    if (!query.code || !this.installState.verify(query.state, CommunityPlatform.discord)) {
      return this.failCallback(actor, CommunityLocalErrorCategory.invalidState);
    }

    let connection: CommunityConnectionRow | undefined;
    try {
      const guild = await this.discord.exchangeCode(query.code);
      connection = await this.connections.upsertFromInstall({
        platform: CommunityPlatform.discord,
        externalId: guild.id,
        name: guild.name,
        status: CommunityConnectionStatus.pending,
      });

      const probe = await this.discord.probe(guild.id);
      await this.connections.updateStatus(connection.id, CommunityConnectionStatus.active);

      await this.audit.record({
        connectionId: connection.id,
        platform: CommunityPlatform.discord,
        actorUserId: actor._id,
        action: CommunityAuditAction.connect,
        outcome: CommunityAuditOutcome.success,
      });
      this.logger.info(
        { connectionId: connection.id, resourceCount: probe.resourceCount },
        'Discord community connected',
      );

      return this.redirectUrl({ connected: CommunityPlatform.discord });
    } catch (error) {
      const category = toErrorCategory(error);
      if (connection) {
        await this.connections.updateStatus(connection.id, statusForFailure(category));
      }
      return this.failCallback(actor, category, connection?.id, error);
    }
  }

  async listResources(actor: OAuthUserRow, id: string): Promise<CommunityResourceDto[]> {
    const connection = await this.getUsableConnection(id);

    try {
      const resources = await this.discord.listResources(connection.externalId);
      await this.recordOutcome(actor, connection, CommunityAuditAction.listResources);
      return resources;
    } catch (error) {
      throw await this.handlePlatformFailure(actor, connection, CommunityAuditAction.listResources, error);
    }
  }

  /** On-demand probe. A failed probe is a reported state, not a failed request. */
  async checkHealth(actor: OAuthUserRow, id: string): Promise<CommunityHealthDto> {
    const connection = await this.getUsableConnection(id);
    const checkedAt = new Date().toISOString();

    try {
      await this.discord.probe(connection.externalId);
      await this.connections.updateStatus(connection.id, CommunityConnectionStatus.active);
      await this.recordOutcome(actor, connection, CommunityAuditAction.healthCheck);

      return { status: CommunityConnectionStatus.active, checkedAt };
    } catch (error) {
      const category = toErrorCategory(error);
      const status = statusForFailure(category);

      await this.connections.updateStatus(connection.id, status);
      await this.recordOutcome(actor, connection, CommunityAuditAction.healthCheck, category);

      return { status, checkedAt, reason: describeErrorCategory(category) };
    }
  }

  /**
   * Removes the bot from the community, then deletes the connection. The bot
   * leaves first: if that fails the row stays so an admin can retry, because a
   * deleted row would leave a bot reading a server nobody is tracking.
   */
  async disconnect(actor: OAuthUserRow, id: string): Promise<void> {
    const connection = await this.getConnectionOrThrow(id);

    try {
      await this.discord.leaveGuild(connection.externalId);
    } catch (error) {
      throw await this.handlePlatformFailure(actor, connection, CommunityAuditAction.disconnect, error);
    }

    await this.recordOutcome(actor, connection, CommunityAuditAction.disconnect);
    await this.connections.deleteById(connection.id);
    this.logger.info({ connectionId: connection.id }, 'Community connection removed and bot left the community');
  }

  private async getConnectionOrThrow(id: string): Promise<CommunityConnectionRow> {
    const connection = await this.connections.findById(id);
    if (!connection) {
      throwNotFoundError(id, COMMUNITY_CONNECTION_ENTITY);
    }
    return connection;
  }

  private async getUsableConnection(id: string): Promise<CommunityConnectionRow> {
    const connection = await this.getConnectionOrThrow(id);
    if (connection.status === CommunityConnectionStatus.disconnected) {
      throw new CommunityConnectionDisconnectedException();
    }
    return connection;
  }

  /**
   * Any platform call is also a health signal: a failure moves the connection
   * to the state its category implies before the error reaches the client.
   */
  private async handlePlatformFailure(
    actor: OAuthUserRow,
    connection: CommunityConnectionRow,
    action: CommunityAuditAction,
    error: unknown,
  ): Promise<Error> {
    const category = toErrorCategory(error);

    await this.connections.updateStatus(connection.id, statusForFailure(category));
    await this.recordOutcome(actor, connection, action, category);

    return new CommunityPlatformException(describeErrorCategory(category));
  }

  private async failCallback(
    actor: OAuthUserRow,
    category: CommunityAuditErrorCategory,
    connectionId?: string,
    error?: unknown,
  ): Promise<string> {
    await this.audit.record({
      connectionId,
      platform: CommunityPlatform.discord,
      actorUserId: actor._id,
      action: CommunityAuditAction.connect,
      outcome: CommunityAuditOutcome.failure,
      errorCategory: category,
    });
    this.logger.warn(
      { connectionId, category, error: error instanceof Error ? error.message : undefined },
      'Discord community connect failed',
    );

    return this.redirectUrl({ error: category });
  }

  private recordOutcome(
    actor: OAuthUserRow,
    connection: CommunityConnectionRow,
    action: CommunityAuditAction,
    errorCategory?: CommunityAuditErrorCategory,
  ): Promise<void> {
    return this.audit.record({
      connectionId: connection.id,
      platform: connection.platform,
      actorUserId: actor._id,
      action,
      outcome: errorCategory ? CommunityAuditOutcome.failure : CommunityAuditOutcome.success,
      errorCategory,
    });
  }

  private redirectUrl(params: Record<string, string>): string {
    const url = new URL(this.connectionsPageUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private toDto(row: CommunityConnectionRow, verification?: LatestVerification): CommunityConnectionDto {
    const failureCategory = verification?.failureCategory;

    return {
      id: row.id,
      platform: row.platform,
      externalId: row.externalId,
      name: row.name,
      status: row.status,
      statusReason:
        row.status === CommunityConnectionStatus.active || !failureCategory
          ? undefined
          : describeErrorCategory(failureCategory),
      lastCheckedAt: verification?.checkedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

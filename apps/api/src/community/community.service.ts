import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildMattermostExternalId,
  type DiscordClient,
  type GitHubClient,
  type MattermostClient,
  type MattermostTeam,
  toErrorCategory,
} from '@reputo/community-api';
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
  GITHUB_CLIENT,
  MATTERMOST_CLIENT,
  statusForFailure,
} from './community.constants';
import {
  CommunityConnectionDisconnectedException,
  CommunityMattermostConnectException,
  CommunityPlatformException,
  CommunityPlatformMismatchException,
} from './community.exceptions';
import { CommunityAuditRepository, type LatestVerification } from './community-audit.repository';
import { CommunityConnectionRepository, type CommunityConnectionRow } from './community-connection.repository';
import { CommunityCredentialsService } from './community-credentials.service';
import { CommunityInstallStateService } from './community-install-state.service';
import { CommunityPlatformRegistry } from './community-platform.registry';
import type {
  CommunityConnectionDto,
  CommunityHealthDto,
  CommunityResourceDto,
  MattermostConnectRequestDto,
  MattermostValidateRequestDto,
  MattermostValidationDto,
} from './dto';

const COMMUNITY_CONNECTION_ENTITY = 'CommunityConnection';

/** GitHub sends this when an organization owner still has to approve the install. */
const GITHUB_SETUP_ACTION_REQUEST = 'request';

@Injectable()
export class CommunityService {
  private readonly connectionsPageUrl: string;

  constructor(
    @InjectPinoLogger(CommunityService.name)
    private readonly logger: PinoLogger,
    private readonly connections: CommunityConnectionRepository,
    private readonly audit: CommunityAuditRepository,
    private readonly installState: CommunityInstallStateService,
    private readonly platforms: CommunityPlatformRegistry,
    @Inject(DISCORD_CLIENT)
    private readonly discord: DiscordClient,
    @Inject(GITHUB_CLIENT)
    private readonly github: GitHubClient,
    @Inject(MATTERMOST_CLIENT)
    private readonly mattermost: MattermostClient,
    private readonly credentials: CommunityCredentialsService,
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
   * Install URL for a new Discord community, or for reconnecting an existing
   * one. A reconnect locks the authorization screen to that community's guild,
   * so an admin fixing a broken connection cannot land on a different server.
   */
  getDiscordInstallUrl(actor: OAuthUserRow, connectionId?: string): Promise<{ url: string }> {
    return this.issueInstallUrl(actor, CommunityPlatform.discord, connectionId, (state, connection) =>
      this.discord.buildInstallUrl(state, connection?.externalId),
    );
  }

  /**
   * Install URL for the GitHub App. GitHub picks the account on its own screen,
   * so a reconnect cannot be locked to one installation the way Discord is; the
   * install is still idempotent per account.
   */
  getGitHubInstallUrl(actor: OAuthUserRow, connectionId?: string): Promise<{ url: string }> {
    return this.issueInstallUrl(actor, CommunityPlatform.github, connectionId, (state) =>
      this.github.buildInstallUrl(state),
    );
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
    const platform = CommunityPlatform.discord;

    if (query.error) {
      return this.failCallback(actor, platform, CommunityLocalErrorCategory.declined);
    }
    if (!query.code || !this.installState.verify(query.state, platform)) {
      return this.failCallback(actor, platform, CommunityLocalErrorCategory.invalidState);
    }

    const code = query.code;
    return this.completeConnect(actor, platform, async () => {
      const guild = await this.discord.exchangeCode(code);
      return { externalId: guild.id, name: guild.name };
    });
  }

  /**
   * Completes a GitHub App install and returns where to send the browser. The
   * installation id arrives in the redirect, so it is confirmed with the app
   * JWT before anything is stored — a forged id names an installation GitHub
   * does not report for this App.
   */
  async handleGitHubCallback(
    actor: OAuthUserRow,
    query: { installation_id?: string; setup_action?: string; state?: string },
  ): Promise<string> {
    const platform = CommunityPlatform.github;

    if (!this.installState.verify(query.state, platform)) {
      return this.failCallback(actor, platform, CommunityLocalErrorCategory.invalidState);
    }
    if (!query.installation_id) {
      // Without an installation the admin either cancelled, or asked an
      // organization owner to approve the App and must come back afterwards.
      const category =
        query.setup_action === GITHUB_SETUP_ACTION_REQUEST
          ? CommunityLocalErrorCategory.approvalRequired
          : CommunityLocalErrorCategory.declined;
      return this.failCallback(actor, platform, category);
    }

    const installationId = query.installation_id;
    return this.completeConnect(actor, platform, async () => {
      const installation = await this.github.confirmInstallation(installationId);
      return { externalId: installation.id, name: installation.account };
    });
  }

  /**
   * Verifies a pasted server URL and token and returns the token's teams.
   * Stores nothing: the admin still has to pick a team before anything exists,
   * and a wrong token fails here with a safe reason code.
   */
  async validateMattermost(
    actor: OAuthUserRow,
    request: MattermostValidateRequestDto,
  ): Promise<MattermostValidationDto> {
    try {
      const { teams } = await this.mattermost.validateToken({ serverUrl: request.serverUrl, token: request.token });
      await this.audit.record({
        platform: CommunityPlatform.mattermost,
        actorUserId: actor._id,
        action: CommunityAuditAction.validate,
        outcome: CommunityAuditOutcome.success,
      });
      return { teams };
    } catch (error) {
      throw await this.failMattermost(actor, CommunityAuditAction.validate, error);
    }
  }

  /**
   * Token-mode connect: validate again server-side, seal the token bound to
   * `{origin}/{teamId}`, save, then probe. The team is resolved from the
   * platform's own answer, so a tampered request cannot name a team the token
   * does not belong to — and the token exists in memory only on this path.
   */
  async connectMattermost(actor: OAuthUserRow, request: MattermostConnectRequestDto): Promise<CommunityConnectionDto> {
    const platform = CommunityPlatform.mattermost;

    let serverUrl: string;
    let teams: MattermostTeam[];
    try {
      ({ serverUrl, teams } = await this.mattermost.validateToken({
        serverUrl: request.serverUrl,
        token: request.token,
      }));
    } catch (error) {
      throw await this.failMattermost(actor, CommunityAuditAction.connect, error);
    }

    const team = teams.find((candidate) => candidate.id === request.teamId);
    if (!team) {
      throw await this.failMattermost(
        actor,
        CommunityAuditAction.connect,
        undefined,
        undefined,
        CommunityLocalErrorCategory.teamNotFound,
      );
    }

    const externalId = buildMattermostExternalId(serverUrl, team.id);
    const connection = await this.connections.upsertFromInstall({
      platform,
      externalId,
      name: team.displayName,
      status: CommunityConnectionStatus.pending,
      credentialsCiphertext: this.credentials.seal({ platform, externalId }, request.token),
    });

    try {
      const probe = await this.platforms.get(platform).probe(externalId);
      const active = await this.connections.updateStatus(connection.id, CommunityConnectionStatus.active);

      await this.recordOutcome(actor, connection, CommunityAuditAction.connect);
      this.logger.info(
        { connectionId: connection.id, platform, resourceCount: probe.resourceCount },
        'Community connected',
      );

      return this.toDto(active ?? connection);
    } catch (error) {
      const category = toErrorCategory(error);
      await this.connections.updateStatus(connection.id, statusForFailure(category));
      throw await this.failMattermost(actor, CommunityAuditAction.connect, error, connection.id);
    }
  }

  async listResources(actor: OAuthUserRow, id: string): Promise<CommunityResourceDto[]> {
    const connection = await this.getUsableConnection(id);

    try {
      const resources = await this.platforms.get(connection.platform).listResources(connection.externalId);
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
      await this.platforms.get(connection.platform).probe(connection.externalId);
      await this.connections.updateStatus(connection.id, CommunityConnectionStatus.active);
      await this.recordOutcome(actor, connection, CommunityAuditAction.healthCheck);

      return { status: CommunityConnectionStatus.active, checkedAt };
    } catch (error) {
      const category = toErrorCategory(error);
      const status = statusForFailure(category);

      await this.connections.updateStatus(connection.id, status);
      await this.recordOutcome(actor, connection, CommunityAuditAction.healthCheck, category);

      return { status, checkedAt, reason: describeErrorCategory(category, connection.platform) };
    }
  }

  /**
   * Revokes Reputo's access on the platform, then deletes the connection.
   * Access goes first: if that fails the row stays so an admin can retry,
   * because a deleted row would leave Reputo reading a community nobody is
   * tracking.
   */
  async disconnect(actor: OAuthUserRow, id: string): Promise<void> {
    const connection = await this.getConnectionOrThrow(id);

    try {
      await this.platforms.get(connection.platform).revokeAccess(connection.externalId);
    } catch (error) {
      throw await this.handlePlatformFailure(actor, connection, CommunityAuditAction.disconnect, error);
    }

    await this.recordOutcome(actor, connection, CommunityAuditAction.disconnect);
    await this.connections.deleteById(connection.id);
    this.logger.info(
      { connectionId: connection.id, platform: connection.platform },
      'Community connection removed and platform access revoked',
    );
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

    return new CommunityPlatformException(describeErrorCategory(category, connection.platform));
  }

  /**
   * Issues a signed install state and the platform's authorization URL. Passing
   * a connection reconnects it, so a connection of another platform is refused
   * rather than silently connecting a second community.
   */
  private async issueInstallUrl(
    actor: OAuthUserRow,
    platform: CommunityPlatform,
    connectionId: string | undefined,
    buildUrl: (state: string, connection?: CommunityConnectionRow) => string,
  ): Promise<{ url: string }> {
    const connection = connectionId ? await this.getConnectionOrThrow(connectionId) : undefined;

    if (connection && connection.platform !== platform) {
      throw new CommunityPlatformMismatchException(platform, connection.platform);
    }

    const url = buildUrl(this.installState.issue(platform), connection);

    await this.audit.record({
      connectionId: connection?.id,
      platform,
      actorUserId: actor._id,
      action: CommunityAuditAction.installUrl,
      outcome: CommunityAuditOutcome.success,
    });

    return { url };
  }

  /**
   * Stores a verified install, probes it, and returns where to send the browser.
   * `resolveCommunity` is the platform's own confirmation step, so an install
   * the platform will not vouch for never reaches the database.
   */
  private async completeConnect(
    actor: OAuthUserRow,
    platform: CommunityPlatform,
    resolveCommunity: () => Promise<{ externalId: string; name: string }>,
  ): Promise<string> {
    let connection: CommunityConnectionRow | undefined;
    try {
      const community = await resolveCommunity();
      connection = await this.connections.upsertFromInstall({
        platform,
        externalId: community.externalId,
        name: community.name,
        status: CommunityConnectionStatus.pending,
      });

      const probe = await this.platforms.get(platform).probe(community.externalId);
      await this.connections.updateStatus(connection.id, CommunityConnectionStatus.active);

      await this.audit.record({
        connectionId: connection.id,
        platform,
        actorUserId: actor._id,
        action: CommunityAuditAction.connect,
        outcome: CommunityAuditOutcome.success,
      });
      this.logger.info(
        { connectionId: connection.id, platform, resourceCount: probe.resourceCount },
        'Community connected',
      );

      return this.redirectUrl({ connected: platform });
    } catch (error) {
      const category = toErrorCategory(error);
      if (connection) {
        await this.connections.updateStatus(connection.id, statusForFailure(category));
      }
      return this.failCallback(actor, platform, category, connection?.id, error);
    }
  }

  /**
   * Audits and logs a failed Mattermost validate/connect, then hands back the
   * exception to throw: a safe reason code the dialog maps to prose. The class
   * name is the only detail logged — a platform error message can embed a
   * response-body snippet.
   */
  private async failMattermost(
    actor: OAuthUserRow,
    action: CommunityAuditAction,
    error: unknown,
    connectionId?: string,
    category: CommunityAuditErrorCategory = toErrorCategory(error),
  ): Promise<CommunityMattermostConnectException> {
    await this.audit.record({
      connectionId,
      platform: CommunityPlatform.mattermost,
      actorUserId: actor._id,
      action,
      outcome: CommunityAuditOutcome.failure,
      errorCategory: category,
    });
    this.logger.warn(
      { connectionId, category, error: error instanceof Error ? error.name : undefined },
      'Mattermost connect flow failed',
    );

    return new CommunityMattermostConnectException(category);
  }

  private async failCallback(
    actor: OAuthUserRow,
    platform: CommunityPlatform,
    category: CommunityAuditErrorCategory,
    connectionId?: string,
    error?: unknown,
  ): Promise<string> {
    await this.audit.record({
      connectionId,
      platform,
      actorUserId: actor._id,
      action: CommunityAuditAction.connect,
      outcome: CommunityAuditOutcome.failure,
      errorCategory: category,
    });
    // The class name is safe; a platform error message can embed a response-body
    // snippet, and the category already carries the diagnostic value.
    this.logger.warn(
      { connectionId, platform, category, error: error instanceof Error ? error.name : undefined },
      'Community connect failed',
    );

    return this.redirectUrl({ error: category, platform });
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
          : describeErrorCategory(failureCategory, row.platform),
      lastCheckedAt: verification?.checkedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

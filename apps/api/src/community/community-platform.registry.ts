import { Inject, Injectable } from '@nestjs/common';
import {
  CommunityAuthError,
  type CommunityProbeResult,
  type CommunityResource,
  type DiscordClient,
  type GitHubClient,
  type MattermostClient,
  type MattermostTeamTarget,
  parseMattermostExternalId,
} from '@reputo/community-api';
import { CommunityPlatform } from '@reputo/contracts';
import { DISCORD_CLIENT, GITHUB_CLIENT, MATTERMOST_CLIENT } from './community.constants';
import { CommunityPlatformUnsupportedException } from './community.exceptions';
import { CommunityConnectionRepository } from './community-connection.repository';
import { CommunityCredentialsService } from './community-credentials.service';

/**
 * The platform-neutral operations every connected community supports, whatever
 * platform it lives on. Connect flows stay platform-specific — they differ in
 * what the platform hands back — but everything after the install is the same.
 */
export interface CommunityPlatformClient {
  listResources(externalId: string): Promise<CommunityResource[]>;
  probe(externalId: string): Promise<CommunityProbeResult>;
  /** Removes Reputo's read access on the platform side. Idempotent. */
  revokeAccess(externalId: string): Promise<void>;
}

/**
 * Resolves a connection's platform to its client, so the connections domain
 * carries no per-platform branching. A platform whose connect flow has not
 * shipped yet resolves to nothing rather than to a stub that would fail late.
 */
@Injectable()
export class CommunityPlatformRegistry {
  private readonly clients: Partial<Record<CommunityPlatform, CommunityPlatformClient>>;

  constructor(
    @Inject(DISCORD_CLIENT) discord: DiscordClient,
    @Inject(GITHUB_CLIENT) github: GitHubClient,
    @Inject(MATTERMOST_CLIENT) mattermost: MattermostClient,
    private readonly connections: CommunityConnectionRepository,
    private readonly credentials: CommunityCredentialsService,
  ) {
    this.clients = {
      [CommunityPlatform.discord]: {
        listResources: (guildId) => discord.listResources(guildId),
        probe: (guildId) => discord.probe(guildId),
        revokeAccess: (guildId) => discord.leaveGuild(guildId),
      },
      [CommunityPlatform.github]: {
        listResources: (installationId) => github.listResources(installationId),
        probe: (installationId) => github.probe(installationId),
        revokeAccess: (installationId) => github.deleteInstallation(installationId),
      },
      [CommunityPlatform.mattermost]: {
        listResources: (externalId) =>
          this.withMattermostTarget(externalId, (target) => mattermost.listResources(target)),
        probe: (externalId) => this.withMattermostTarget(externalId, (target) => mattermost.probe(target)),
        // The token belongs to the admin's own bot and stays valid; deleting
        // the connection removes Reputo's only sealed copy of it.
        revokeAccess: async () => undefined,
      },
    };
  }

  /** Undefined for a platform Reputo cannot read yet. */
  find(platform: CommunityPlatform): CommunityPlatformClient | undefined {
    return this.clients[platform];
  }

  get(platform: CommunityPlatform): CommunityPlatformClient {
    const client = this.find(platform);
    if (!client) {
      throw new CommunityPlatformUnsupportedException(platform);
    }
    return client;
  }

  /**
   * Unseals the token immediately before the outbound call, per call — the
   * plaintext lives in this stack frame and nowhere else.
   */
  private async withMattermostTarget<T>(
    externalId: string,
    operation: (target: MattermostTeamTarget) => Promise<T>,
  ): Promise<T> {
    const platform = CommunityPlatform.mattermost;
    const ciphertext = await this.connections.findCredentialsCiphertext(platform, externalId);
    if (ciphertext === null) {
      throw new CommunityAuthError('No sealed token is stored for this connection. Reconnect the server.', 401);
    }

    const { serverUrl, teamId } = parseMattermostExternalId(externalId);
    const token = this.credentials.open({ platform, externalId }, ciphertext);
    return operation({ serverUrl, teamId, token });
  }
}

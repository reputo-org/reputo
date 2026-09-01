import { Inject, Injectable } from '@nestjs/common';
import type { CommunityProbeResult, CommunityResource, DiscordClient, GitHubClient } from '@reputo/community-api';
import { CommunityPlatform } from '@reputo/contracts';
import { DISCORD_CLIENT, GITHUB_CLIENT } from './community.constants';
import { CommunityPlatformUnsupportedException } from './community.exceptions';

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

  constructor(@Inject(DISCORD_CLIENT) discord: DiscordClient, @Inject(GITHUB_CLIENT) github: GitHubClient) {
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
}

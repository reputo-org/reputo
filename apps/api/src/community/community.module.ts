import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  createDiscordClient,
  createGitHubClient,
  createMattermostClient,
  type DiscordClientConfig,
  type GitHubClientConfig,
  type MattermostClientConfig,
} from '@reputo/community-api';
import { PinoLogger } from 'nestjs-pino';
import { CommunityConnectionAuditEntity, CommunityConnectionEntity } from '../persistence';
import { RolesGuard } from '../shared/guards/roles.guard';
import { DISCORD_CLIENT, GITHUB_CLIENT, MATTERMOST_CLIENT } from './community.constants';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { CommunityAuditRepository } from './community-audit.repository';
import { CommunityConnectionRepository } from './community-connection.repository';
import { CommunityCredentialsService } from './community-credentials.service';
import { CommunityEventsService } from './community-events.service';
import { CommunityHealthSweepService } from './community-health-sweep.service';
import { CommunityInputValidationService } from './community-input-validation.service';
import { CommunityInstallStateService } from './community-install-state.service';
import { CommunityPlatformRegistry } from './community-platform.registry';

@Module({
  imports: [TypeOrmModule.forFeature([CommunityConnectionEntity, CommunityConnectionAuditEntity])],
  controllers: [CommunityController],
  providers: [
    CommunityConnectionRepository,
    CommunityAuditRepository,
    CommunityCredentialsService,
    CommunityEventsService,
    CommunityHealthSweepService,
    CommunityInstallStateService,
    CommunityInputValidationService,
    CommunityPlatformRegistry,
    CommunityService,
    RolesGuard,
    {
      provide: DISCORD_CLIENT,
      inject: [ConfigService, PinoLogger],
      useFactory: (configService: ConfigService, logger: PinoLogger) =>
        createDiscordClient(configService.get<DiscordClientConfig>('community.discord') as DiscordClientConfig, logger),
    },
    {
      provide: GITHUB_CLIENT,
      inject: [ConfigService, PinoLogger],
      useFactory: (configService: ConfigService, logger: PinoLogger) =>
        createGitHubClient(configService.get<GitHubClientConfig>('community.github') as GitHubClientConfig, logger),
    },
    {
      provide: MATTERMOST_CLIENT,
      inject: [ConfigService, PinoLogger],
      useFactory: (configService: ConfigService, logger: PinoLogger) =>
        createMattermostClient(
          configService.get<MattermostClientConfig>('community.mattermost') as MattermostClientConfig,
          logger,
        ),
    },
  ],
  exports: [CommunityConnectionRepository, CommunityInputValidationService, CommunityService],
})
export class CommunityModule {}

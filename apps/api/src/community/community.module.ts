import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createDiscordClient, type DiscordClientConfig } from '@reputo/community-api';
import { PinoLogger } from 'nestjs-pino';
import { CommunityConnectionAuditEntity, CommunityConnectionEntity } from '../persistence';
import { RolesGuard } from '../shared/guards/roles.guard';
import { DISCORD_CLIENT } from './community.constants';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { CommunityAuditRepository } from './community-audit.repository';
import { CommunityConnectionRepository } from './community-connection.repository';
import { CommunityInputValidationService } from './community-input-validation.service';
import { CommunityInstallStateService } from './community-install-state.service';

@Module({
  imports: [TypeOrmModule.forFeature([CommunityConnectionEntity, CommunityConnectionAuditEntity])],
  controllers: [CommunityController],
  providers: [
    CommunityConnectionRepository,
    CommunityAuditRepository,
    CommunityInstallStateService,
    CommunityInputValidationService,
    CommunityService,
    RolesGuard,
    {
      provide: DISCORD_CLIENT,
      inject: [ConfigService, PinoLogger],
      useFactory: (configService: ConfigService, logger: PinoLogger) =>
        createDiscordClient(configService.get<DiscordClientConfig>('community.discord') as DiscordClientConfig, logger),
    },
  ],
  exports: [CommunityConnectionRepository, CommunityInputValidationService],
})
export class CommunityModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OAuthConsentGrantEntity } from '../persistence';
import { OAuthProviderClient } from '../shared/oauth';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { OAuthConsentGrantRepository } from './oauth-consent-grant.repository';
import { OAuthConsentGrantCleanupService } from './oauth-consent-grant-cleanup.service';

// `PersistenceModule` is registered globally in `src/persistence`; feature
// modules use `TypeOrmModule.forFeature(...)` to bind their entity repos.
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([OAuthConsentGrantEntity])],
  controllers: [ConsentController],
  providers: [ConsentService, OAuthConsentGrantRepository, OAuthConsentGrantCleanupService, OAuthProviderClient],
  exports: [OAuthConsentGrantCleanupService],
})
export class ConsentModule {}

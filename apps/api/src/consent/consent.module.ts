import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OAuthProviderClient } from '../shared/oauth';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { OAuthConsentGrantRepository } from './oauth-consent-grant.repository';
import { OAuthConsentGrantCleanupService } from './oauth-consent-grant-cleanup.service';

// PrismaModule is registered globally in `src/persistence`, so feature
// modules can depend on `PrismaService` directly without importing it here.
@Module({
  imports: [ConfigModule],
  controllers: [ConsentController],
  providers: [ConsentService, OAuthConsentGrantRepository, OAuthConsentGrantCleanupService, OAuthProviderClient],
  exports: [OAuthConsentGrantCleanupService],
})
export class ConsentModule {}

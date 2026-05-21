import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OAuthProviderClient } from '../shared/oauth';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { OAuthConsentGrantRepository } from './oauth-consent-grant.repository';
import { OAuthConsentGrantCleanupService } from './oauth-consent-grant-cleanup.service';

// PrismaModule is registered globally in `src/persistence`, so feature
// modules can depend on `PrismaService` directly without importing it here.
// The cleanup service is co-located here because it owns the PG-side
// replacement for the Mongo TTL index on `oauth_consent_grant.expiresAt`.
@Module({
  imports: [ConfigModule],
  controllers: [ConsentController],
  providers: [ConsentService, OAuthConsentGrantRepository, OAuthConsentGrantCleanupService, OAuthProviderClient],
  exports: [OAuthConsentGrantCleanupService],
})
export class ConsentModule {}

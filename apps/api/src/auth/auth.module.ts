import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from '../admin';
import { SessionsModule } from '../sessions';
import { SessionAuthGuard } from '../shared/guards';
import { OAuthProviderClient } from '../shared/oauth';
import { UsersModule } from '../users';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCookieService } from './auth-cookie.service';
import { OAuthAuthProviderService } from './oauth-auth-provider.service';

@Module({
  imports: [ConfigModule, UsersModule, SessionsModule, AdminModule],
  controllers: [AuthController],
  providers: [
    AuthCookieService,
    AuthService,
    OAuthAuthProviderService,
    OAuthProviderClient,
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}

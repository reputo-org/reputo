import { Module } from '@nestjs/common';
import { OAuthUserRepository } from './oauth-user.repository';

// PrismaModule is registered globally in `src/persistence`, so feature
// modules can depend on `PrismaService` directly without importing it here.
@Module({
  providers: [OAuthUserRepository],
  exports: [OAuthUserRepository],
})
export class UsersModule {}

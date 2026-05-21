import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthSessionRepository } from './auth-session.repository';
import { AuthSessionCleanupService } from './auth-session-cleanup.service';

// PrismaModule is registered globally in `src/persistence`, so feature
// modules can depend on `PrismaService` directly without importing it here.
@Module({
  imports: [ConfigModule],
  providers: [AuthSessionRepository, AuthSessionCleanupService],
  exports: [AuthSessionRepository, AuthSessionCleanupService],
})
export class SessionsModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthSessionEntity } from '../persistence';
import { AuthSessionRepository } from './auth-session.repository';
import { AuthSessionCleanupService } from './auth-session-cleanup.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AuthSessionEntity])],
  providers: [AuthSessionRepository, AuthSessionCleanupService],
  exports: [AuthSessionRepository, AuthSessionCleanupService],
})
export class SessionsModule {}

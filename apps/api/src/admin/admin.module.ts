import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAllowlistEntity } from '../persistence';
import { SessionsModule } from '../sessions';
import { RolesGuard } from '../shared/guards/roles.guard';
import { UsersModule } from '../users';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAllowlistRepository } from './admin-allowlist.repository';
import { AdminOwnerSeeder } from './admin-owner.seeder';

// `PersistenceModule` is registered globally in `src/persistence`; feature
// modules use `TypeOrmModule.forFeature(...)` to bind their entity repos.
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AccessAllowlistEntity]), UsersModule, SessionsModule],
  controllers: [AdminController],
  providers: [AdminAllowlistRepository, AdminService, AdminOwnerSeeder, RolesGuard],
  exports: [AdminService],
})
export class AdminModule {}

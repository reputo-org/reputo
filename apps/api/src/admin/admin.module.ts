import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AccessAllowlistSchema, MODEL_NAMES } from '@reputo/database';
import { SessionsModule } from '../sessions';
import { RolesGuard } from '../shared/guards/roles.guard';
import { UsersModule } from '../users';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAllowlistRepository } from './admin-allowlist.repository';
import { AdminOwnerSeeder } from './admin-owner.seeder';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    SessionsModule,
    MongooseModule.forFeature([
      {
        name: MODEL_NAMES.ACCESS_ALLOWLIST,
        schema: AccessAllowlistSchema,
      },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminAllowlistRepository, AdminService, AdminOwnerSeeder, RolesGuard],
  exports: [AdminService],
})
export class AdminModule {}

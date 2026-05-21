import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { SnapshotListenerService } from './snapshot-listener.service';

// Marked @Global so feature modules can inject PrismaService without
// re-importing PrismaModule everywhere; there is exactly one PG connection
// pool per process and this matches how ConfigModule is registered.
//
// `SnapshotListenerService` lives here too because it owns a long-lived
// `pg.Client` LISTEN connection that is part of the persistence layer
// (separate from Prisma's pool — see service docstring).
@Global()
@Module({
  providers: [PrismaService, SnapshotListenerService],
  exports: [PrismaService, SnapshotListenerService],
})
export class PrismaModule {}

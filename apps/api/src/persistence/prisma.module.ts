import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

// Marked @Global so feature modules can inject PrismaService without
// re-importing PrismaModule everywhere; there is exactly one PG connection
// pool per process and this matches how ConfigModule is registered.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

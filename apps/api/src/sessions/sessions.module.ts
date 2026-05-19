import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthSessionSchema, MODEL_NAMES } from '@reputo/database';
import { AuthSessionRepository } from './auth-session.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: MODEL_NAMES.AUTH_SESSION,
        schema: AuthSessionSchema,
      },
    ]),
  ],
  providers: [AuthSessionRepository],
  exports: [AuthSessionRepository, MongooseModule],
})
export class SessionsModule {}

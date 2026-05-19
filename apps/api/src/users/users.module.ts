import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MODEL_NAMES, OAuthUserSchema } from '@reputo/database';
import { OAuthUserRepository } from './oauth-user.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: MODEL_NAMES.OAUTH_USER,
        schema: OAuthUserSchema,
      },
    ]),
  ],
  providers: [OAuthUserRepository],
  exports: [OAuthUserRepository, MongooseModule],
})
export class UsersModule {}

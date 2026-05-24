import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OAuthUserEntity } from '../persistence';
import { OAuthUserRepository } from './oauth-user.repository';

@Module({
  imports: [TypeOrmModule.forFeature([OAuthUserEntity])],
  providers: [OAuthUserRepository],
  exports: [OAuthUserRepository],
})
export class UsersModule {}

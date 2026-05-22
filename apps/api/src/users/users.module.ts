import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OAuthUserEntity } from '../persistence';
import { OAuthUserRepository } from './oauth-user.repository';

// `PersistenceModule` is registered globally in `src/persistence`; feature
// modules use `TypeOrmModule.forFeature(...)` to bind their entity repos.
@Module({
  imports: [TypeOrmModule.forFeature([OAuthUserEntity])],
  providers: [OAuthUserRepository],
  exports: [OAuthUserRepository],
})
export class UsersModule {}

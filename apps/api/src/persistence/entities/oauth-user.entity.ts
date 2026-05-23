import { OAUTH_PROVIDERS, type OAuthProvider } from '@reputo/contracts';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AccessAllowlistEntity } from './access-allowlist.entity';
import { AuthSessionEntity } from './auth-session.entity';

@Entity({ name: 'oauth_users' })
@Index('oauth_users_provider_sub_key', ['provider', 'sub'], { unique: true })
export class OAuthUserEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'enum', enum: OAUTH_PROVIDERS, enumName: 'oauth_provider' })
  provider!: OAuthProvider;

  @Column({ type: 'text' })
  sub!: string;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  aud!: string[];

  @Column({ type: 'int', nullable: true })
  authTime!: number | null;

  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ type: 'boolean', nullable: true })
  emailVerified!: boolean | null;

  @Column({ type: 'int', nullable: true })
  iat!: number | null;

  @Column({ type: 'text', nullable: true })
  iss!: string | null;

  @Column({ type: 'text', nullable: true })
  picture!: string | null;

  @Column({ type: 'int', nullable: true })
  rat!: number | null;

  @Column({ type: 'text', nullable: true })
  username!: string | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @OneToMany(
    () => AuthSessionEntity,
    (session) => session.user,
  )
  sessions!: AuthSessionEntity[];

  @OneToMany(
    () => AccessAllowlistEntity,
    (allowlist) => allowlist.invitedByUser,
  )
  invitedEntries!: AccessAllowlistEntity[];

  @OneToMany(
    () => AccessAllowlistEntity,
    (allowlist) => allowlist.revokedByUser,
  )
  revokedEntries!: AccessAllowlistEntity[];

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

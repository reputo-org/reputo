import { ACCESS_ROLES, type AccessRole, OAUTH_PROVIDERS, type OAuthProvider } from '@reputo/contracts';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { OAuthUserEntity } from './oauth-user.entity';

@Entity({ name: 'access_allowlist' })
@Index('access_allowlist_provider_email_key', ['provider', 'email'], { unique: true })
@Index('access_allowlist_revoked_at_idx', ['revokedAt'])
export class AccessAllowlistEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'enum', enum: OAUTH_PROVIDERS, enumName: 'oauth_provider' })
  provider!: OAuthProvider;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'enum', enum: ACCESS_ROLES, enumName: 'access_role' })
  role!: AccessRole;

  @Column({ type: 'uuid', nullable: true })
  invitedByUserId!: string | null;

  @CreateDateColumn({ name: 'invited_at', type: 'timestamp', precision: 3 })
  invitedAt!: Date;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  revokedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(
    () => OAuthUserEntity,
    (user) => user.invitedEntries,
    {
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      nullable: true,
    },
  )
  @JoinColumn({ name: 'invited_by_user_id' })
  invitedByUser!: OAuthUserEntity | null;

  @ManyToOne(
    () => OAuthUserEntity,
    (user) => user.revokedEntries,
    {
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      nullable: true,
    },
  )
  @JoinColumn({ name: 'revoked_by_user_id' })
  revokedByUser!: OAuthUserEntity | null;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

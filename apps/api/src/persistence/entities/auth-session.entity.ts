import { OAUTH_PROVIDERS, type OAuthProvider } from '@reputo/contracts';
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

@Entity({ name: 'auth_sessions' })
@Index('auth_sessions_session_id_key', ['sessionId'], { unique: true })
@Index('auth_sessions_user_id_idx', ['userId'])
@Index('auth_sessions_expires_at_idx', ['expiresAt'])
@Index('auth_sessions_revoked_at_idx', ['revokedAt'])
export class AuthSessionEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text' })
  sessionId!: string;

  @Column({ type: 'enum', enum: OAUTH_PROVIDERS, enumName: 'oauth_provider' })
  provider!: OAuthProvider;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'text' })
  accessTokenCiphertext!: string;

  @Column({ type: 'text' })
  refreshTokenCiphertext!: string;

  @Column({ type: 'timestamp', precision: 3 })
  accessTokenExpiresAt!: Date;

  @Column({ type: 'timestamp', precision: 3 })
  refreshTokenExpiresAt!: Date;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  scope!: string[];

  @Column({ type: 'text' })
  state!: string;

  @Column({ type: 'text' })
  codeVerifier!: string;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  lastRefreshedAt!: Date | null;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'timestamp', precision: 3 })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(
    () => OAuthUserEntity,
    (user) => user.sessions,
    {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'user_id' })
  user!: OAuthUserEntity;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

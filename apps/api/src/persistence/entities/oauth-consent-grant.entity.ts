import { OAUTH_PROVIDERS, type OAuthProvider } from '@reputo/contracts';
import { BeforeInsert, Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

@Entity({ name: 'oauth_consent_grants' })
@Index('oauth_consent_grants_state_key', ['state'], { unique: true })
@Index('oauth_consent_grants_provider_source_idx', ['provider', 'source'])
export class OAuthConsentGrantEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'enum', enum: OAUTH_PROVIDERS, enumName: 'oauth_provider' })
  provider!: OAuthProvider;

  @Column({ type: 'text' })
  source!: string;

  @Column({ type: 'text' })
  state!: string;

  @Column({ type: 'text' })
  codeVerifier!: string;

  @Column({ type: 'timestamp', precision: 3 })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

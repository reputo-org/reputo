import {
  COMMUNITY_CONNECTION_STATUSES,
  COMMUNITY_PLATFORMS,
  type CommunityConnectionStatus,
  type CommunityPlatform,
  CommunityConnectionStatus as ConnectionStatus,
} from '@reputo/contracts';
import { BeforeInsert, Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

@Entity({ name: 'community_connections' })
@Index('community_connections_platform_external_id_key', ['platform', 'externalId'], { unique: true })
export class CommunityConnectionEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'enum', enum: COMMUNITY_PLATFORMS, enumName: 'community_platform' })
  platform!: CommunityPlatform;

  /** Platform-side identifier of the connected community — a Discord guild id. */
  @Column({ type: 'text' })
  externalId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'jsonb', nullable: true })
  settings!: unknown;

  /**
   * Sealed platform credential, for platforms that need one. Discord and GitHub
   * authenticate with deployment config, so this stays null until Mattermost
   * introduces sealing.
   */
  @Column({ type: 'text', nullable: true })
  credentialsCiphertext!: string | null;

  @Column({
    type: 'enum',
    enum: COMMUNITY_CONNECTION_STATUSES,
    enumName: 'community_connection_status',
    default: ConnectionStatus.pending,
  })
  status!: CommunityConnectionStatus;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

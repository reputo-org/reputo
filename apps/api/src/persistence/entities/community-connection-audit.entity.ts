import { COMMUNITY_PLATFORMS, type CommunityPlatform } from '@reputo/contracts';
import { BeforeInsert, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { CommunityConnectionEntity } from './community-connection.entity';

/**
 * Append-only record of every privileged connection operation. It stores no
 * tokens and no request or response bodies — actor, action, outcome, and a safe
 * error category only.
 *
 * `action`, `outcome`, and `errorCategory` are text rather than Postgres enums:
 * each new platform adds categories, and an append-only log should not need a
 * type migration to record one.
 */
@Entity({ name: 'community_connection_audit' })
@Index('community_connection_audit_connection_id_idx', ['connectionId'])
@Index('community_connection_audit_created_at_idx', ['createdAt'])
export class CommunityConnectionAuditEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  /** Null when the operation failed before a connection existed. */
  @Column({ type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ type: 'enum', enum: COMMUNITY_PLATFORMS, enumName: 'community_platform' })
  platform!: CommunityPlatform;

  /** Null once the acting user row is gone; the audit row outlives it. */
  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'text' })
  action!: string;

  @Column({ type: 'text' })
  outcome!: string;

  @Column({ type: 'text', nullable: true })
  errorCategory!: string | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => CommunityConnectionEntity, undefined, { onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'connection_id' })
  connection!: CommunityConnectionEntity | null;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

import { SNAPSHOT_PUBLICATION_STATUSES, SnapshotPublicationStatus } from '@reputo/contracts';
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
import { SnapshotEntity } from './snapshot.entity';

/**
 * One snapshot's DeepID publication record, per algorithm key. Written by the
 * workflow through the `recordSnapshotPublication` activity with upsert
 * semantics, so a retried publication rewrites its row instead of adding one.
 * `error` holds a safe category or summary — never a DeepID response body.
 */
@Entity({ name: 'snapshot_publications' })
@Index('snapshot_publications_snapshot_id_idx', ['snapshotId'])
@Index('snapshot_publications_snapshot_id_algorithm_key_key', ['snapshotId', 'algorithmKey'], { unique: true })
export class SnapshotPublicationEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid' })
  snapshotId!: string;

  @Column({ type: 'text' })
  algorithmKey!: string;

  @Column({
    type: 'enum',
    enum: SNAPSHOT_PUBLICATION_STATUSES,
    enumName: 'snapshot_publication_status',
    default: SnapshotPublicationStatus.pending,
  })
  status!: SnapshotPublicationStatus;

  @Column({ type: 'jsonb', nullable: true })
  counts!: unknown;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(
    () => SnapshotEntity,
    (snapshot) => snapshot.publications,
    {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'snapshot_id' })
  snapshot!: SnapshotEntity;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

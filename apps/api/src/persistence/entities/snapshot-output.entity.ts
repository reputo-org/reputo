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

@Entity({ name: 'snapshot_outputs' })
@Index('snapshot_outputs_snapshot_id_idx', ['snapshotId'])
@Index('snapshot_outputs_snapshot_id_key_key', ['snapshotId', 'key'], { unique: true })
export class SnapshotOutputEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid' })
  snapshotId!: string;

  @Column({ type: 'text' })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(
    () => SnapshotEntity,
    (snapshot) => snapshot.outputs,
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

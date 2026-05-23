import { SNAPSHOT_STATUS, SnapshotStatus } from '@reputo/contracts';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AlgorithmPresetEntity } from './algorithm-preset.entity';
import { SnapshotOutputEntity } from './snapshot-output.entity';

@Entity({ name: 'snapshots' })
@Index('snapshots_algorithm_preset_id_idx', ['algorithmPresetId'])
export class SnapshotEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({
    type: 'enum',
    enum: SNAPSHOT_STATUS,
    enumName: 'snapshot_status',
    default: SnapshotStatus.queued,
  })
  status!: SnapshotStatus;

  @Column({ type: 'uuid' })
  algorithmPresetId!: string;

  @Column({ type: 'jsonb' })
  algorithmPresetFrozen!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  temporal!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  error!: unknown;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(
    () => AlgorithmPresetEntity,
    (preset) => preset.snapshots,
    {
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'algorithm_preset_id' })
  algorithmPreset!: AlgorithmPresetEntity;

  @OneToMany(
    () => SnapshotOutputEntity,
    (output) => output.snapshot,
    {
      cascade: ['insert'],
    },
  )
  outputs!: SnapshotOutputEntity[];

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

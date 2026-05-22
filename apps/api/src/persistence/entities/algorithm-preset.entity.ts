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
import { AlgorithmPresetInputEntity } from './algorithm-preset-input.entity';
import { SnapshotEntity } from './snapshot.entity';

@Entity({ name: 'algorithm_presets' })
@Index('algorithm_presets_key_idx', ['key'])
@Index('algorithm_presets_version_idx', ['version'])
@Index('algorithm_presets_key_version_idx', ['key', 'version'])
export class AlgorithmPresetEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text' })
  key!: string;

  @Column({ type: 'text' })
  version!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @OneToMany(
    () => AlgorithmPresetInputEntity,
    (input) => input.algorithmPreset,
    {
      cascade: ['insert'],
    },
  )
  inputs!: AlgorithmPresetInputEntity[];

  @OneToMany(
    () => SnapshotEntity,
    (snapshot) => snapshot.algorithmPreset,
  )
  snapshots!: SnapshotEntity[];

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

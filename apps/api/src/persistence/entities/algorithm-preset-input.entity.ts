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
import { AlgorithmPresetEntity } from './algorithm-preset.entity';

@Entity({ name: 'algorithm_preset_inputs' })
@Index('algorithm_preset_inputs_algorithm_preset_id_idx', ['algorithmPresetId'])
@Index('algorithm_preset_inputs_algorithm_preset_id_key_key', ['algorithmPresetId', 'key'], {
  unique: true,
})
export class AlgorithmPresetInputEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid' })
  algorithmPresetId!: string;

  @Column({ type: 'text' })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  @Column({ type: 'int' })
  position!: number;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(
    () => AlgorithmPresetEntity,
    (preset) => preset.inputs,
    {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'algorithm_preset_id' })
  algorithmPreset!: AlgorithmPresetEntity;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}

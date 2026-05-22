import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'meta' })
export class MetaEntity {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'text' })
  value!: string;
}

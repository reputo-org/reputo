import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'pools' })
export class PoolEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  slug!: string;

  @Column({ type: 'integer' })
  maxFundingAmount!: number;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text' })
  rawJson!: string;
}

import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'rounds' })
export class RoundEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text' })
  poolIds!: string;

  @Column({ type: 'text' })
  rawJson!: string;
}

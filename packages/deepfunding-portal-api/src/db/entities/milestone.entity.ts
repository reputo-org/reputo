import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'milestones' })
export class MilestoneEntity {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'integer' })
  proposalId!: number;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text' })
  developmentDescription!: string;

  @Column({ type: 'integer' })
  budget!: number;

  @Column({ type: 'text', nullable: true })
  createdAt!: string | null;

  @Column({ type: 'text', nullable: true })
  updatedAt!: string | null;

  @Column({ type: 'text' })
  rawJson!: string;
}

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'proposals' })
@Index('idx_proposals_round_id', ['roundId'])
@Index('idx_proposals_pool_id', ['poolId'])
export class ProposalEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'integer' })
  roundId!: number;

  @Column({ type: 'integer' })
  poolId!: number;

  @Column({ type: 'integer' })
  proposerId!: number;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'text' })
  link!: string;

  @Column({ type: 'text' })
  featureImage!: string;

  @Column({ type: 'text' })
  requestedAmount!: string;

  @Column({ type: 'text' })
  awardedAmount!: string;

  @Column({ type: 'boolean' })
  isAwarded!: boolean;

  @Column({ type: 'boolean' })
  isCompleted!: boolean;

  @Column({ type: 'text' })
  createdAt!: string;

  @Column({ type: 'text', nullable: true })
  updatedAt!: string | null;

  @Column({ type: 'text' })
  teamMembers!: string;

  @Column({ type: 'text' })
  rawJson!: string;
}

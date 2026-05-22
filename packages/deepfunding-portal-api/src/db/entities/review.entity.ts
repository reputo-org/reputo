import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'reviews' })
@Index('idx_reviews_proposal_id', ['proposalId'])
@Index('idx_reviews_reviewer_id', ['reviewerId'])
export class ReviewEntity {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'review_id' })
  reviewId!: number;

  @Column({ type: 'integer', nullable: true })
  proposalId!: number | null;

  @Column({ type: 'integer', nullable: true })
  reviewerId!: number | null;

  @Column({ type: 'text' })
  reviewType!: string;

  @Column({ type: 'text' })
  overallRating!: string;

  @Column({ type: 'text' })
  feasibilityRating!: string;

  @Column({ type: 'text' })
  viabilityRating!: string;

  @Column({ type: 'text' })
  desirabilityRating!: string;

  @Column({ type: 'text' })
  usefulnessRating!: string;

  @Column({ type: 'text', nullable: true })
  createdAt!: string | null;

  @Column({ type: 'text' })
  rawJson!: string;
}

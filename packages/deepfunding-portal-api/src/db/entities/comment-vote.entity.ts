import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'comment_votes' })
@Index('idx_comment_votes_comment_id', ['commentId'])
export class CommentVoteEntity {
  @PrimaryColumn({ type: 'integer' })
  voterId!: number;

  @PrimaryColumn({ type: 'integer' })
  commentId!: number;

  @Column({ type: 'text' })
  voteType!: string;

  @Column({ type: 'text', nullable: true })
  createdAt!: string | null;

  @Column({ type: 'text' })
  rawJson!: string;
}

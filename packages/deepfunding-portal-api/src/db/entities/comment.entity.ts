import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'comments' })
@Index('idx_comments_proposal_id', ['proposalId'])
@Index('idx_comments_user_id', ['userId'])
export class CommentEntity {
  @PrimaryColumn({ type: 'integer', name: 'comment_id' })
  commentId!: number;

  @Column({ type: 'integer' })
  parentId!: number;

  @Column({ type: 'boolean' })
  isReply!: boolean;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'integer' })
  proposalId!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'text' })
  commentVotes!: string;

  @Column({ type: 'text' })
  createdAt!: string;

  @Column({ type: 'text' })
  updatedAt!: string;

  @Column({ type: 'text' })
  rawJson!: string;
}

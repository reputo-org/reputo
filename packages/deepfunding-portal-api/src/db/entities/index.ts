import { CommentEntity } from './comment.entity.js';
import { CommentVoteEntity } from './comment-vote.entity.js';
import { MetaEntity } from './meta.entity.js';
import { MilestoneEntity } from './milestone.entity.js';
import { PoolEntity } from './pool.entity.js';
import { ProposalEntity } from './proposal.entity.js';
import { ReviewEntity } from './review.entity.js';
import { RoundEntity } from './round.entity.js';
import { UserEntity } from './user.entity.js';

export { CommentEntity } from './comment.entity.js';
export { CommentVoteEntity } from './comment-vote.entity.js';
export { MetaEntity } from './meta.entity.js';
export { MilestoneEntity } from './milestone.entity.js';
export { PoolEntity } from './pool.entity.js';
export { ProposalEntity } from './proposal.entity.js';
export { ReviewEntity } from './review.entity.js';
export { RoundEntity } from './round.entity.js';
export { UserEntity } from './user.entity.js';

export const ENTITIES = [
  RoundEntity,
  PoolEntity,
  ProposalEntity,
  UserEntity,
  MilestoneEntity,
  ReviewEntity,
  CommentEntity,
  CommentVoteEntity,
  MetaEntity,
] as const;

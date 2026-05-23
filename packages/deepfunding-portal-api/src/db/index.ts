/**
 * Database module for DeepFunding Portal API
 */

export type {
  CreateDbOptions,
  DeepFundingPortalDb,
} from '../shared/types/db.js';
export { closeDbInstance, createDb } from './client.js';
export { AppDataSource, buildDataSourceOptions } from './data-source.js';
export {
  CommentEntity,
  CommentVoteEntity,
  ENTITIES,
  MetaEntity,
  MilestoneEntity,
  PoolEntity,
  ProposalEntity,
  ReviewEntity,
  RoundEntity,
  UserEntity,
} from './entities/index.js';
export { Init1748000000000, MIGRATIONS } from './migrations/index.js';

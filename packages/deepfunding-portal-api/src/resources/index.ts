import type { DeepFundingPortalDb } from '../shared/types/db.js';
import { createCommentsRepo } from './comments/repository.js';
import { createCommentVotesRepo } from './commentVotes/repository.js';
import { createMilestonesRepo } from './milestones/repository.js';
import { createPoolsRepo } from './pools/repository.js';
import { createProposalsRepo } from './proposals/repository.js';
import { createReviewsRepo } from './reviews/repository.js';
import { createRoundsRepo } from './rounds/repository.js';
import { createUsersRepo } from './users/repository.js';

/**
 * Create all repositories bound to a specific database instance.
 *
 * Use this together with {@link import('../db/client.js').createDb} to get a
 * fully isolated set of repos that is safe for concurrent algorithm execution.
 */
export function createRepos(db: DeepFundingPortalDb) {
  return {
    rounds: createRoundsRepo(db),
    pools: createPoolsRepo(db),
    proposals: createProposalsRepo(db),
    users: createUsersRepo(db),
    milestones: createMilestonesRepo(db),
    reviews: createReviewsRepo(db),
    comments: createCommentsRepo(db),
    commentVotes: createCommentVotesRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;

export * from './comments/api.js';
export * from './comments/normalize.js';
export { type CommentsRepo, createCommentsRepo } from './comments/repository.js';
export * from './comments/schema.js';
export type * from './comments/types.js';

export * from './commentVotes/api.js';
export * from './commentVotes/normalize.js';
export { type CommentVotesRepo, createCommentVotesRepo } from './commentVotes/repository.js';
export * from './commentVotes/schema.js';
export type * from './commentVotes/types.js';

export * from './milestones/api.js';
export * from './milestones/normalize.js';
export { createMilestonesRepo, type MilestonesRepo } from './milestones/repository.js';
export * from './milestones/schema.js';
export type * from './milestones/types.js';

export * from './pools/api.js';
export * from './pools/normalize.js';
export { createPoolsRepo, type PoolsRepo } from './pools/repository.js';
export * from './pools/schema.js';
export type * from './pools/types.js';

export * from './proposals/api.js';
export * from './proposals/normalize.js';
export { createProposalsRepo, type ProposalsRepo } from './proposals/repository.js';
export * from './proposals/schema.js';
export type * from './proposals/types.js';

export * from './reviews/api.js';
export * from './reviews/normalize.js';
export { createReviewsRepo, type ReviewsRepo } from './reviews/repository.js';
export * from './reviews/schema.js';
export type * from './reviews/types.js';

export * from './rounds/api.js';
export * from './rounds/normalize.js';
export { createRoundsRepo, type RoundsRepo } from './rounds/repository.js';
export * from './rounds/schema.js';
export type * from './rounds/types.js';

export * from './users/api.js';
export * from './users/normalize.js';
export { createUsersRepo, type UsersRepo } from './users/repository.js';
export * from './users/schema.js';
export type * from './users/types.js';

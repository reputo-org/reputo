import type { Comment } from '../../src/resources/comments/types.js';
import type { CommentVote } from '../../src/resources/commentVotes/types.js';
import type { Milestone, MilestoneRaw } from '../../src/resources/milestones/types.js';
import type { Pool } from '../../src/resources/pools/types.js';
import type { ProposalWithRound } from '../../src/resources/proposals/types.js';
import type { Review } from '../../src/resources/reviews/types.js';
import type { Round } from '../../src/resources/rounds/types.js';
import type { User } from '../../src/resources/users/types.js';

export function createMockMilestone(overrides?: Partial<Milestone>): Milestone {
  return {
    id: 1,
    proposal_id: 1,
    title: 'Test Milestone',
    status: 'in_progress',
    description: 'Test description',
    development_description: 'Test dev description',
    budget: 1000,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...overrides,
  };
}

/**
 * Milestone shape as it appears nested inside the per-proposal group in the
 * API response (no proposal metadata yet).
 */
export function createMockMilestoneRaw(overrides?: Partial<MilestoneRaw>): MilestoneRaw {
  return {
    id: 1,
    title: 'Test Milestone',
    status: 'in_progress',
    description: 'Test description',
    development_description: 'Test dev description',
    budget: 1000,
    ...overrides,
  };
}

export function createMockProposal(overrides?: Partial<ProposalWithRound>): ProposalWithRound {
  return {
    id: 1,
    round_id: 1,
    pool_id: 1,
    proposer_id: 1,
    title: 'Test Proposal',
    content: 'Test content',
    link: 'https://example.com',
    feature_image: 'https://example.com/image.jpg',
    requested_amount: '10000',
    awarded_amount: '5000',
    is_awarded: true,
    is_completed: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    team_members: [],
    ...overrides,
  };
}

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 1,
    collection_id: 'test-collection',
    user_name: 'testuser',
    email: 'test@example.com',
    total_proposals: 5,
    did: 'did:plc:abc123abc123abc123abc123',
    ...overrides,
  };
}

export function createMockRound(overrides?: Partial<Round>): Round {
  return {
    id: 1,
    name: 'Test Round',
    slug: 'test-round',
    description: 'Test round description',
    pool_id: [{ id: 1 }, { id: 2 }],
    ...overrides,
  };
}

export function createMockPool(overrides?: Partial<Pool>): Pool {
  return {
    id: 1,
    name: 'Test Pool',
    slug: 'test-pool',
    max_funding_amount: 100000,
    description: 'Test pool description',
    ...overrides,
  };
}

export function createMockComment(overrides?: Partial<Comment>): Comment {
  return {
    comment_id: 1,
    parent_id: 0,
    is_reply: false,
    user_id: 1,
    proposal_id: 1,
    content: 'Test comment',
    comment_votes: 5,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...overrides,
  };
}

export function createMockCommentVote(overrides?: Partial<CommentVote>): CommentVote {
  return {
    voter_id: 1,
    comment_id: 1,
    vote_type: 'upvote',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export function createMockReview(overrides?: Partial<Review>): Review {
  return {
    proposal_id: 1,
    reviewer_id: 1,
    review_type: 'expert',
    overall_rating: 'good',
    feasibility_rating: 'high',
    viability_rating: 'medium',
    desirability_rating: 'high',
    usefulness_rating: 'high',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

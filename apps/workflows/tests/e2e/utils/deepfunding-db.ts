import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type Comment,
  type CommentVote,
  closeDbInstance,
  createDb,
  createRepos,
  type ProposalWithRound,
  type Review,
  type User,
} from '@reputo/deepfunding-portal-api';

/**
 * Rows to seed into a fresh DeepFunding portal SQLite DB. Only the tables the
 * scoring algorithms read are exposed (proposals, reviews, users, comments,
 * comment_votes). Shapes are the package's snake_case API input types — the repos
 * normalize them on insert exactly as the production sync activity does (e.g.
 * `users.did` is canonicalized to `did:plc:<suffix>`).
 */
export interface DeepfundingSeed {
  users?: User[];
  proposals?: ProposalWithRound[];
  comments?: Comment[];
  commentVotes?: CommentVote[];
  reviews?: Review[];
}

/**
 * Builds a real DeepFunding portal SQLite DB on a temp path (running the
 * package's TypeORM init migration), seeds it via the repos, then returns the raw
 * file bytes. Upload these under `getDeepfundingDbKey(snapshotId)` and the
 * algorithm's `createDeepFundingDb` will download and open them unchanged —
 * byte-identical to what the production sync activity produces.
 */
export async function buildDeepfundingDbBytes(seed: DeepfundingSeed): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'reputo-e2e-deepfunding-'));
  const path = join(dir, 'deepfunding.db');
  const db = await createDb({ path });
  try {
    const repos = createRepos(db);
    if (seed.users?.length) await repos.users.createMany(seed.users);
    if (seed.proposals?.length) await repos.proposals.createMany(seed.proposals);
    if (seed.comments?.length) await repos.comments.createMany(seed.comments);
    if (seed.commentVotes?.length) await repos.commentVotes.createMany(seed.commentVotes);
    if (seed.reviews?.length) await repos.reviews.createMany(seed.reviews);
  } finally {
    await closeDbInstance(db);
  }
  const bytes = await readFile(path);
  await rm(dir, { recursive: true, force: true });
  return bytes;
}

// ── Row factories ──────────────────────────────────────────────────────────
// Fill production-realistic defaults so a test only states the fields that
// affect the scenario under test.

export function userSeed(o: Partial<User> & { id: number; did: string }): User {
  return {
    id: o.id,
    collection_id: o.collection_id ?? `collection-${o.id}`,
    user_name: o.user_name ?? `user-${o.id}`,
    email: o.email ?? `user-${o.id}@example.com`,
    total_proposals: o.total_proposals ?? 0,
    did: o.did,
    ...o,
  };
}

export function proposalSeed(o: Partial<ProposalWithRound> & { id: number }): ProposalWithRound {
  return {
    id: o.id,
    round_id: o.round_id ?? 1,
    pool_id: o.pool_id ?? 1,
    proposer_id: o.proposer_id ?? 1,
    title: o.title ?? `Proposal ${o.id}`,
    content: o.content ?? 'content',
    link: o.link ?? 'https://example.com',
    feature_image: o.feature_image ?? 'https://example.com/image.jpg',
    requested_amount: o.requested_amount ?? '10000',
    awarded_amount: o.awarded_amount ?? '0',
    is_awarded: o.is_awarded ?? false,
    is_completed: o.is_completed ?? false,
    created_at: o.created_at ?? '2024-01-01T00:00:00Z',
    updated_at: o.updated_at ?? '2024-01-02T00:00:00Z',
    team_members: o.team_members ?? [],
    ...o,
  };
}

export function commentSeed(
  o: Partial<Comment> & { comment_id: number; user_id: number; proposal_id: number; created_at: string },
): Comment {
  return {
    comment_id: o.comment_id,
    parent_id: o.parent_id ?? 0,
    is_reply: o.is_reply ?? false,
    user_id: o.user_id,
    proposal_id: o.proposal_id,
    content: o.content ?? 'comment',
    comment_votes: o.comment_votes ?? 0,
    votes: o.votes ?? { up: 0, down: 0 },
    created_at: o.created_at,
    updated_at: o.updated_at ?? o.created_at,
    ...o,
  };
}

export function commentVoteSeed(o: Partial<CommentVote> & { voter_id: number; comment_id: number }): CommentVote {
  return {
    voter_id: o.voter_id,
    comment_id: o.comment_id,
    vote_type: o.vote_type ?? 'upvote',
    created_at: o.created_at ?? '2024-01-01T00:00:00Z',
    ...o,
  };
}

export function reviewSeed(o: Partial<Review> & { proposal_id: number }): Review {
  return {
    proposal_id: o.proposal_id,
    reviewer_id: o.reviewer_id ?? 1,
    review_type: o.review_type ?? 'community',
    overall_rating: o.overall_rating ?? '4',
    feasibility_rating: o.feasibility_rating ?? '4',
    viability_rating: o.viability_rating ?? '4',
    desirability_rating: o.desirability_rating ?? '4',
    usefulness_rating: o.usefulness_rating ?? '4',
    created_at: o.created_at ?? '2024-01-01T00:00:00Z',
    ...o,
  };
}

import type { Pagination, PaginationOptions } from '../../shared/types/index.js';

export type VoteType = 'upvote' | 'downvote';

export type CommentVote = {
  voter_id: number;
  comment_id: number;
  vote_type: VoteType;
  created_at: string;
  [key: string]: unknown;
};

export type CommentVoteApiResponse = {
  votes: CommentVote[];
  pagination: Pagination;
};

export type CommentVoteRecord = {
  voterId: number;
  commentId: number;
  voteType: string;
  createdAt: string | null;
  rawJson: string;
};

export type CommentVoteFetchOptions = PaginationOptions;

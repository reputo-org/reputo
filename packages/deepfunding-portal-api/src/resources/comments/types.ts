import type { Pagination, PaginationOptions } from '../../shared/types/index.js';

export type Comment = {
  comment_id: number;
  parent_id: number;
  is_reply: boolean;
  user_id: number;
  proposal_id: number;
  content: string;
  comment_votes: number | string;
  votes: {
    up: number;
    down: number;
  };
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};

export type CommentApiResponse = {
  comments: Comment[];
  pagination: Pagination;
};

export type CommentRecord = {
  commentId: number;
  parentId: number;
  isReply: boolean;
  userId: number;
  proposalId: number;
  content: string;
  commentVotes: string;
  createdAt: string;
  updatedAt: string;
  rawJson: string;
};

export type CommentFetchOptions = PaginationOptions;

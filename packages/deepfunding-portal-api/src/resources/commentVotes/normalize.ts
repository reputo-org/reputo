import type { CommentVote, CommentVoteRecord } from './types.js';

export function normalizeCommentVoteToRecord(data: CommentVote): CommentVoteRecord {
  return {
    voterId: data.voter_id,
    commentId: data.comment_id,
    voteType: data.vote_type,
    createdAt: data.created_at ?? null,
    rawJson: JSON.stringify(data),
  };
}

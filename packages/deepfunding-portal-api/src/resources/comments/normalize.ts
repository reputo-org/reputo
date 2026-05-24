import type { Comment, CommentRecord } from './types.js';

export function normalizeCommentToRecord(data: Comment): CommentRecord {
  return {
    commentId: data.comment_id,
    parentId: data.parent_id,
    isReply: data.is_reply,
    userId: data.user_id,
    proposalId: data.proposal_id,
    content: data.content,
    commentVotes: String(data.comment_votes),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    rawJson: JSON.stringify(data),
  };
}

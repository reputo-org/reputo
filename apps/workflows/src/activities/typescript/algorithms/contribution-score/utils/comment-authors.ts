import type { CommentRecord } from '@reputo/deepfunding-portal-api';

export function buildCommentAuthorMap(comments: CommentRecord[]): Map<number, number> {
  const authorMap = new Map<number, number>();
  for (const comment of comments) {
    authorMap.set(comment.commentId, comment.userId);
  }
  return authorMap;
}

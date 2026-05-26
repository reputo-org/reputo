import type { CommentRecord } from '@reputo/deepfunding-portal-api';

export interface SelfInteractionContext {
  relationMap: Map<string, boolean>;
  commentAuthorMap: Map<number, number>;
}

export interface SelfInteractionResult {
  isRelatedProject: boolean;
  isSameAuthorReply: boolean;
  discountConditions: number;
  discountMultiplier: number;
}

/**
 * Self-interaction penalty conditions:
 * 1. Author is related to the proposal (proposer or team member)
 * 2. Comment is a reply to another comment by the same author
 *
 * Each condition applies the penalty factor multiplicatively.
 */
export function detectSelfInteraction(
  comment: CommentRecord,
  penaltyFactor: number,
  context: SelfInteractionContext,
): SelfInteractionResult {
  const { relationMap, commentAuthorMap } = context;
  const authorId = comment.userId;
  const proposalId = comment.proposalId;

  let discountConditions = 0;

  const isRelatedProject = relationMap.get(`${authorId}-${proposalId}`) === true;
  if (isRelatedProject) {
    discountConditions++;
  }

  let isSameAuthorReply = false;
  const isReply = comment.isReply === true;
  if (isReply && comment.parentId > 0) {
    const parentAuthorId = commentAuthorMap.get(comment.parentId);
    if (parentAuthorId === authorId) {
      discountConditions++;
      isSameAuthorReply = true;
    }
  }

  const discountMultiplier = penaltyFactor ** discountConditions;

  return {
    isRelatedProject,
    isSameAuthorReply,
    discountConditions,
    discountMultiplier,
  };
}

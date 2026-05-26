import type { CommentVoteRecord } from '@reputo/deepfunding-portal-api';

export interface VoteStats {
  upvotes: number;
  downvotes: number;
  upvoterIds: Set<number>;
}

export function aggregateVotesByComment(commentVotes: CommentVoteRecord[]): Map<number, VoteStats> {
  const voteMap = new Map<number, VoteStats>();

  for (const vote of commentVotes) {
    let entry = voteMap.get(vote.commentId);
    if (!entry) {
      entry = { upvotes: 0, downvotes: 0, upvoterIds: new Set() };
      voteMap.set(vote.commentId, entry);
    }

    if (vote.voteType === 'upvote') {
      entry.upvotes++;
      entry.upvoterIds.add(vote.voterId);
    } else if (vote.voteType === 'downvote') {
      entry.downvotes++;
    }
  }

  return voteMap;
}

export function getVoteStats(commentId: number, voteMap: Map<number, VoteStats>): VoteStats {
  return (
    voteMap.get(commentId) ?? {
      upvotes: 0,
      downvotes: 0,
      upvoterIds: new Set<number>(),
    }
  );
}

import type { ProposalRecord } from '@reputo/deepfunding-portal-api';

import type { CommunityScoreResult } from '../pipeline/community-scores.js';
import type { ProposalStatusInfo } from '../pipeline/proposal-classification.js';
import type { ProposalScoreResult } from '../pipeline/proposal-scoring.js';
import type { TimeWeightResult } from '../pipeline/time-weight.js';
import type {
  DidProposalBenchmarkRecord,
  ProposalBenchmarkRecord,
  ProposalEngagementBenchmark,
  ProposalEngagementParams,
} from '../types.js';

export function buildProposalBenchmarkRecord(
  proposal: ProposalRecord,
  owners: { proposerId: number; teamMembersArray: number[]; ownersArray: number[] },
  status: ProposalStatusInfo,
  communityScore: CommunityScoreResult,
  timeWeight: TimeWeightResult,
  scoreResult: ProposalScoreResult,
): ProposalBenchmarkRecord {
  return {
    proposal_id: proposal.id,
    round_id: proposal.roundId,
    created_at: proposal.createdAt,
    owners: {
      proposer_id: owners.proposerId,
      team_member_ids: owners.teamMembersArray,
      all_owner_ids: owners.ownersArray,
    },
    classification: {
      is_awarded: status.isAwarded,
      is_completed: status.isCompleted,
      classification: status.classification,
    },
    community_score: {
      count: communityScore.count,
      avg: communityScore.avg,
      norm: communityScore.norm,
    },
    time_weight: {
      tw: timeWeight.tw,
      age_months: timeWeight.ageMonths,
      bucket_index: timeWeight.bucketIndex,
      is_valid: timeWeight.isValid,
      is_within_window: timeWeight.isWithinWindow,
    },
    score: {
      proposal_reward: scoreResult.proposalReward,
      proposal_penalty: scoreResult.proposalPenalty,
      scored: scoreResult.scored,
      skip_reason: scoreResult.skipReason,
    },
  };
}

export interface FormatBenchmarkInput {
  records: ProposalBenchmarkRecord[];
  snapshotId: string;
  dids: string[];
  didScores: Map<string, number>;
  didAccumulators: Map<string, { positiveSum: number; negativeSum: number }>;
  matchedDids: Set<string>;
  /** Portal user id → DID, to attribute each proposal's owners to DIDs. */
  userIdToDid: Map<number, string>;
  params: ProposalEngagementParams;
  totalProposalsProcessed: number;
  totalProposalsScored: number;
  proposalsSkippedUnsupportedRound: number;
}

export function formatBenchmarkOutput(input: FormatBenchmarkInput): ProposalEngagementBenchmark {
  const {
    records,
    snapshotId,
    dids,
    didScores,
    didAccumulators,
    matchedDids,
    userIdToDid,
    params,
    totalProposalsProcessed,
    totalProposalsScored,
    proposalsSkippedUnsupportedRound,
  } = input;

  const didProposalMap = new Map<string, ProposalBenchmarkRecord[]>();

  for (const record of records) {
    const recordDids = new Set<string>();
    for (const ownerId of record.owners.all_owner_ids) {
      const did = userIdToDid.get(ownerId);
      if (did !== undefined) {
        recordDids.add(did);
      }
    }

    for (const did of recordDids) {
      const list = didProposalMap.get(did) ?? [];
      list.push(record);
      didProposalMap.set(did, list);
    }
  }

  const didRows: DidProposalBenchmarkRecord[] = [];

  for (const did of dids) {
    const proposals = didProposalMap.get(did) ?? [];
    const engagement = didScores.get(did) ?? 0;
    const acc = didAccumulators.get(did);
    didRows.push({
      did: did,
      proposal_engagement: engagement,
      positive_sum: acc?.positiveSum ?? 0,
      negative_sum: acc?.negativeSum ?? 0,
      proposal_count: proposals.length,
      proposals,
    });
  }

  didRows.sort((a, b) => a.did.localeCompare(b.did));
  const matchedIds = [...matchedDids].sort((a, b) => a.localeCompare(b));
  const unmatchedIds = dids.filter((did) => !matchedDids.has(did));

  return {
    dids: didRows,
    metadata: {
      snapshot_id: snapshotId,
      computed_at: new Date().toISOString(),
      config: {
        fundedConcludedRewardWeight: params.fundedConcludedRewardWeight,
        unfundedPenaltyWeight: params.unfundedPenaltyWeight,
        engagementWindowMonths: params.engagementWindowMonths,
        monthlyDecayRatePercent: params.monthlyDecayRatePercent,
      },
      dids: {
        provided_ids: dids,
        matched_ids: matchedIds,
        unmatched_ids: unmatchedIds,
      },
      metrics: {
        total_dids_provided: dids.length,
        dids_with_matching_owner: matchedIds.length,
        total_proposals_processed: totalProposalsProcessed,
        total_proposals_scored: totalProposalsScored,
        proposals_skipped_unsupported_round: proposalsSkippedUnsupportedRound,
      },
    },
  };
}

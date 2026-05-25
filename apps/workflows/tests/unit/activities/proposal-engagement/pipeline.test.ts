import type { ProposalRecord, ReviewRecord } from '@reputo/deepfunding-portal-api';
import { describe, expect, it } from 'vitest';
import {
  aggregateCommunityRatings,
  computeCommunityScore,
} from '../../../../src/activities/typescript/algorithms/proposal-engagement/pipeline/community-scores.js';
import {
  classifyProposal,
  isScorableClassification,
} from '../../../../src/activities/typescript/algorithms/proposal-engagement/pipeline/proposal-classification.js';
import {
  calculateTimeWeight,
  computeTimeWeightFromString,
} from '../../../../src/activities/typescript/algorithms/proposal-engagement/pipeline/time-weight.js';
import {
  buildProposalOwners,
  parseTeamMembers,
} from '../../../../src/activities/typescript/algorithms/proposal-engagement/utils/team-members.js';

const review = (overrides: Partial<ReviewRecord>): ReviewRecord =>
  ({
    reviewType: 'community',
    proposalId: 1,
    overallRating: '4.0',
    ...overrides,
  }) as ReviewRecord;

describe('community-scores', () => {
  it('aggregates only community-type reviews with a proposal id', () => {
    const reviews = [
      review({ proposalId: 1, overallRating: '4.0' }),
      review({ proposalId: 1, overallRating: '5.0' }),
      review({ proposalId: 1, overallRating: '2.0', reviewType: 'expert' }),
      review({ proposalId: undefined as unknown as number, overallRating: '5.0' }),
      review({ proposalId: 2, overallRating: '3.5' }),
    ];

    const result = aggregateCommunityRatings(reviews);

    expect(result.get(1)).toEqual({ sum: 9, count: 2 });
    expect(result.get(2)).toEqual({ sum: 3.5, count: 1 });
  });

  it('returns null avg/norm when no community ratings exist for the proposal', () => {
    const result = computeCommunityScore(99, new Map());
    expect(result).toEqual({ count: 0, avg: null, norm: null });
  });

  it('normalizes to a 0-1 range assuming a 5-point scale', () => {
    const stats = new Map([[1, { sum: 9, count: 2 }]]);

    const result = computeCommunityScore(1, stats);

    expect(result.count).toBe(2);
    expect(result.avg).toBe(4.5);
    expect(result.norm).toBe(0.9);
  });

  it('handles a zero-count entry defensively', () => {
    const stats = new Map([[1, { sum: 0, count: 0 }]]);
    const result = computeCommunityScore(1, stats);
    expect(result).toEqual({ count: 0, avg: null, norm: null });
  });
});

describe('proposal-classification', () => {
  const proposal = (isAwarded: boolean | number, isCompleted: boolean | number): ProposalRecord =>
    ({ isAwarded, isCompleted }) as ProposalRecord;

  it('classifies awarded + completed proposals as funded_concluded', () => {
    expect(classifyProposal(proposal(true, true)).classification).toBe('funded_concluded');
  });

  it('classifies awarded-but-incomplete proposals as other', () => {
    expect(classifyProposal(proposal(true, false)).classification).toBe('other');
  });

  it('classifies non-awarded proposals as unfunded regardless of completion', () => {
    expect(classifyProposal(proposal(false, false)).classification).toBe('unfunded');
    expect(classifyProposal(proposal(false, true)).classification).toBe('unfunded');
  });

  it('accepts numeric (1/0) flags as booleans', () => {
    expect(classifyProposal(proposal(1, 1)).classification).toBe('funded_concluded');
    expect(classifyProposal(proposal(0, 0)).classification).toBe('unfunded');
  });

  it('flags scorable classifications', () => {
    expect(isScorableClassification('funded_concluded')).toBe(true);
    expect(isScorableClassification('unfunded')).toBe(true);
    expect(isScorableClassification('other')).toBe(false);
  });
});

describe('proposal-engagement time-weight', () => {
  const params = { engagementWindowMonths: 12, monthlyDecayRatePercent: 10 };

  it('returns full weight for fresh proposals', () => {
    const result = calculateTimeWeight(new Date('2026-04-29T00:00:00Z'), new Date('2026-05-01T00:00:00Z'), params);
    expect(result.tw).toBe(1);
    expect(result.isWithinWindow).toBe(true);
  });

  it('returns zero weight beyond the window', () => {
    const result = calculateTimeWeight(new Date('2024-01-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'), params);
    expect(result.tw).toBe(0);
    expect(result.isWithinWindow).toBe(false);
  });

  it('parses string input via the helper', () => {
    const result = computeTimeWeightFromString('2026-04-29T00:00:00Z', new Date('2026-05-01T00:00:00Z'), params);
    expect(result.tw).toBe(1);
  });
});

describe('team-members', () => {
  it('parses a JSON-encoded list of numeric member ids', () => {
    expect(parseTeamMembers('[1, "2", 3]')).toEqual([1, 2, 3]);
    expect(parseTeamMembers('[]')).toEqual([]);
  });

  it('builds a sorted owner array containing the proposer and team members', () => {
    const proposal = { proposerId: 5, teamMembers: '[3, 1, 7]' } as ProposalRecord;

    const result = buildProposalOwners(proposal);

    expect(result.ownersArray).toEqual([1, 3, 5, 7]);
    expect(result.teamMembersArray).toEqual([1, 3, 7]);
    expect(result.owners.has(5)).toBe(true);
  });

  it('de-duplicates a proposer that appears in the team members array', () => {
    const proposal = { proposerId: 1, teamMembers: '[1, 2]' } as ProposalRecord;
    const result = buildProposalOwners(proposal);
    expect(result.ownersArray).toEqual([1, 2]);
  });
});

import type { ProposalRecord } from '@reputo/deepfunding-portal-api';

import type { ProposalClassification } from '../types.js';

export interface ProposalStatusInfo {
  isAwarded: boolean;
  isCompleted: boolean;
  classification: ProposalClassification;
}

function toBool(value: boolean | number): boolean {
  return value === true || value === 1;
}

/**
 * Classification rules:
 * - funded_concluded: Awarded AND completed
 * - unfunded: NOT awarded (regardless of completion)
 * - other: Awarded but NOT completed (in progress)
 */
export function classifyProposal(proposal: ProposalRecord): ProposalStatusInfo {
  const isAwarded = toBool(proposal.isAwarded);
  const isCompleted = toBool(proposal.isCompleted);

  let classification: ProposalClassification;

  if (isAwarded && isCompleted) {
    classification = 'funded_concluded';
  } else if (!isAwarded) {
    classification = 'unfunded';
  } else {
    classification = 'other';
  }

  return { isAwarded, isCompleted, classification };
}

/** Only 'funded_concluded' and 'unfunded' proposals are scored. */
export function isScorableClassification(classification: ProposalClassification): boolean {
  return classification === 'funded_concluded' || classification === 'unfunded';
}

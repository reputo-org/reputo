import type { User, UserRecord } from './types.js';

export function normalizeUserToRecord(data: User): UserRecord {
  return {
    id: data.id,
    collectionId: data.collection_id,
    userName: data.user_name,
    email: data.email,
    totalProposals: data.total_proposals,
    did: data.did,
    rawJson: JSON.stringify(data),
  };
}

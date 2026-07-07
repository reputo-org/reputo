import type { User, UserRecord } from './types.js';

/**
 * Canonicalizes a Proposal Portal user identifier into a DeepID DID. The portal
 * stores a bare value (the 24-char DID suffix) without a method prefix, so we
 * prefix `did:plc:` — portal identities are `did:plc`, while wallet-derived
 * identities are `did:sub`. Already-prefixed values pass through unchanged
 * (idempotent), and a missing/blank value becomes `''` so the NOT NULL column
 * never aborts the snapshot insert (blank DIDs are skipped downstream instead).
 */
export function toCanonicalPortalDid(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  return trimmed.startsWith('did:') ? trimmed : `did:plc:${trimmed}`;
}

export function normalizeUserToRecord(data: User): UserRecord {
  return {
    id: data.id,
    collectionId: data.collection_id,
    userName: data.user_name,
    email: data.email,
    totalProposals: data.total_proposals,
    did: toCanonicalPortalDid(data.did),
    rawJson: JSON.stringify(data),
  };
}

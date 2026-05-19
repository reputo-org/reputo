import type { HydratedDocument, Model, Types } from 'mongoose';
import type { AccessRole, OAuthProvider } from '../constants/index.js';

/**
 * Interface defining an email-keyed access allowlist entry for provider login gates.
 */
export interface AccessAllowlist {
  /** Upstream auth provider identifier */
  provider: OAuthProvider;
  /** Lowercased and trimmed email address used as the provider join key */
  email: string;
  /** Access role granted to the email address */
  role: AccessRole;
  /** OAuthUser document identifier that invited this entry, absent for seeded owners */
  invitedBy?: Types.ObjectId | string | null;
  /** Timestamp when this entry was invited */
  invitedAt: Date;
  /** Timestamp when this entry was revoked */
  revokedAt?: Date | null;
  /** OAuthUser document identifier that revoked this entry */
  revokedBy?: Types.ObjectId | string | null;
  /** Document creation timestamp */
  createdAt?: Date;
  /** Document last update timestamp */
  updatedAt?: Date;
}

/**
 * Type representing a hydrated AccessAllowlist document with explicit _id.
 */
export type AccessAllowlistDoc = HydratedDocument<AccessAllowlist> & { _id: Types.ObjectId };

/**
 * AccessAllowlist document with _id for lean query results.
 */
export type AccessAllowlistWithId = AccessAllowlist & { _id: Types.ObjectId };

/**
 * Mongoose model interface for AccessAllowlist documents.
 */
export interface AccessAllowlistModel extends Model<AccessAllowlist> {}

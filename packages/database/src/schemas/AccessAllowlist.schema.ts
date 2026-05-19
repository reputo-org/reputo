import { Schema } from 'mongoose';
import { ACCESS_ROLES, MODEL_NAMES, OAUTH_PROVIDERS } from '../shared/constants/index.js';
import type { AccessAllowlist, AccessAllowlistModel } from '../shared/types/index.js';

/**
 * Mongoose schema for AccessAllowlist documents.
 */
const AccessAllowlistSchema = new Schema<AccessAllowlist, AccessAllowlistModel>(
  {
    provider: {
      type: String,
      enum: OAUTH_PROVIDERS,
      required: true,
      immutable: true,
    },
    email: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (email: string) => email.length > 0,
        message: 'email must not be empty',
      },
    },
    role: {
      type: String,
      enum: ACCESS_ROLES,
      required: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: MODEL_NAMES.OAUTH_USER,
    },
    invitedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
    },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: MODEL_NAMES.OAUTH_USER,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
);

AccessAllowlistSchema.index({ provider: 1, email: 1 }, { unique: true });
AccessAllowlistSchema.index({ revokedAt: 1 });

export default AccessAllowlistSchema as Schema<AccessAllowlist, AccessAllowlistModel>;

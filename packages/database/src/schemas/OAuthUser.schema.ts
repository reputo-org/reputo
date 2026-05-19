import { Schema } from 'mongoose';
import { OAUTH_PROVIDERS } from '../shared/constants/index.js';
import type { OAuthUser, OAuthUserModel } from '../shared/types/index.js';

/**
 * Mongoose schema for OAuthUser documents.
 */
const OAuthUserSchema = new Schema<OAuthUser, OAuthUserModel>(
  {
    provider: {
      type: String,
      enum: OAUTH_PROVIDERS,
      required: true,
      immutable: true,
    },
    sub: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },
    aud: {
      type: [{ type: String, trim: true }],
    },
    auth_time: {
      type: Number,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    email_verified: {
      type: Boolean,
    },
    iat: {
      type: Number,
    },
    iss: {
      type: String,
      trim: true,
    },
    picture: {
      type: String,
      trim: true,
    },
    rat: {
      type: Number,
    },
    username: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
);

OAuthUserSchema.index({ provider: 1, sub: 1 }, { unique: true });

export default OAuthUserSchema as Schema<OAuthUser, OAuthUserModel>;

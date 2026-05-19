import { model } from 'mongoose';
import { AccessAllowlistSchema } from '../schemas/index.js';
import { MODEL_NAMES } from '../shared/constants/index.js';
import type { AccessAllowlist, AccessAllowlistModel } from '../shared/types/index.js';

/**
 * Mongoose model for AccessAllowlist documents.
 */
export default model<AccessAllowlist, AccessAllowlistModel>(MODEL_NAMES.ACCESS_ALLOWLIST, AccessAllowlistSchema);

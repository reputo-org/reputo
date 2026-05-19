/**
 * @reputo/database
 *
 * Mongoose-based database layer for the Reputo ecosystem.
 * Provides type-safe models, schemas, and interfaces for managing
 * algorithm presets and snapshots.
 */

// Export connection utilities
export { connect, disconnect } from './connection.js';
// Export models (as values with Model suffix for clarity)
export {
  AccessAllowlistModel,
  AccessAllowlistModel as AccessAllowlistModelValue,
  AlgorithmPresetModel as AlgorithmPresetModelValue,
  AuthSessionModel as AuthSessionModelValue,
  OAuthConsentGrantModel as OAuthConsentGrantModelValue,
  OAuthUserModel as OAuthUserModelValue,
  SnapshotModel as SnapshotModelValue,
} from './models/index.js';
// Export schemas
export {
  AccessAllowlistSchema,
  AlgorithmPresetSchema,
  AuthSessionSchema,
  OAuthConsentGrantSchema,
  OAuthUserSchema,
  SnapshotSchema,
} from './schemas/index.js';
// Export shared utilities (includes types AlgorithmPresetModel, SnapshotModel as interfaces)
export * from './shared/index.js';

import { AccessAllowlistEntity } from './access-allowlist.entity';
import { AlgorithmPresetEntity } from './algorithm-preset.entity';
import { AlgorithmPresetInputEntity } from './algorithm-preset-input.entity';
import { AuthSessionEntity } from './auth-session.entity';
import { OAuthConsentGrantEntity } from './oauth-consent-grant.entity';
import { OAuthUserEntity } from './oauth-user.entity';
import { SnapshotEntity } from './snapshot.entity';
import { SnapshotOutputEntity } from './snapshot-output.entity';

export { AccessAllowlistEntity } from './access-allowlist.entity';
export { AlgorithmPresetEntity } from './algorithm-preset.entity';
export { AlgorithmPresetInputEntity } from './algorithm-preset-input.entity';
export { AuthSessionEntity } from './auth-session.entity';
export { OAuthConsentGrantEntity } from './oauth-consent-grant.entity';
export { OAuthUserEntity } from './oauth-user.entity';
export { SnapshotEntity } from './snapshot.entity';
export { SnapshotOutputEntity } from './snapshot-output.entity';

export const ENTITIES = [
  AlgorithmPresetEntity,
  AlgorithmPresetInputEntity,
  SnapshotEntity,
  SnapshotOutputEntity,
  OAuthUserEntity,
  AuthSessionEntity,
  OAuthConsentGrantEntity,
  AccessAllowlistEntity,
] as const;

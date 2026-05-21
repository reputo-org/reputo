import { describe, expect, it } from 'vitest';

import {
  ACCESS_ROLE_ADMIN,
  ACCESS_ROLE_OWNER,
  ACCESS_ROLES,
  AUTH_SESSION_PRIVATE_FIELDS,
  OAUTH_PROVIDERS,
  OAuthProviderDeepId,
  SNAPSHOT_STATUS,
  SnapshotStatus,
} from '../../src/index.js';

describe('@reputo/contracts enums', () => {
  it('snapshot status enum exposes the expected wire values', () => {
    expect(SnapshotStatus.queued).toBe('queued');
    expect(SnapshotStatus.running).toBe('running');
    expect(SnapshotStatus.completed).toBe('completed');
    expect(SnapshotStatus.failed).toBe('failed');
    expect(SnapshotStatus.cancelled).toBe('cancelled');
    expect(SNAPSHOT_STATUS).toEqual(['queued', 'running', 'completed', 'failed', 'cancelled']);
  });

  it('oauth provider enum is the deep-id provider', () => {
    expect(OAuthProviderDeepId).toBe('deep-id');
    expect(OAUTH_PROVIDERS).toEqual(['deep-id']);
  });

  it('access roles list owner then admin', () => {
    expect(ACCESS_ROLE_OWNER).toBe('owner');
    expect(ACCESS_ROLE_ADMIN).toBe('admin');
    expect(ACCESS_ROLES).toEqual(['owner', 'admin']);
  });

  it('auth session private fields cover tokens and ceremony material', () => {
    expect(AUTH_SESSION_PRIVATE_FIELDS).toEqual([
      'accessTokenCiphertext',
      'refreshTokenCiphertext',
      'state',
      'codeVerifier',
    ]);
  });
});

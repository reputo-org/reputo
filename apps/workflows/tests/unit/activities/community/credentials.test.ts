import { sealCommunityCredential } from '@reputo/community-api';
import { describe, expect, it, vi } from 'vitest';
import { createCommunityCredentialsReader } from '../../../../src/activities/community/credentials.js';

const KEYRING = { currentSecret: 'workflow-credentials-test-key-0123456789abcdef' };
const EXTERNAL_ID = 'https://chat.example.com:8065/team-1';
const TOKEN = 'mm-worker-token';

function fakePool(rows: Array<{ credentials_ciphertext: string | null }>) {
  return { query: vi.fn(async () => ({ rows })), end: vi.fn(async () => undefined) };
}

describe('createCommunityCredentialsReader', () => {
  it('reads the ciphertext by platform and external id and unseals the target', async () => {
    const ciphertext = sealCommunityCredential(KEYRING, { platform: 'mattermost', externalId: EXTERNAL_ID }, TOKEN);
    const pool = fakePool([{ credentials_ciphertext: ciphertext }]);
    const reader = createCommunityCredentialsReader({ databaseUrl: 'postgresql://unused', keyring: KEYRING }, pool);

    const target = await reader.readMattermostTarget(EXTERNAL_ID);

    expect(target).toEqual({ serverUrl: 'https://chat.example.com:8065', teamId: 'team-1', token: TOKEN });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('credentials_ciphertext'), [
      'mattermost',
      EXTERNAL_ID,
    ]);
  });

  it('opens envelopes sealed under the previous key after rotation', async () => {
    const ciphertext = sealCommunityCredential(KEYRING, { platform: 'mattermost', externalId: EXTERNAL_ID }, TOKEN);
    const rotated = {
      currentSecret: 'workflow-credentials-rotated-key-0123456789abcd',
      previousSecret: KEYRING.currentSecret,
    };
    const reader = createCommunityCredentialsReader(
      { databaseUrl: 'postgresql://unused', keyring: rotated },
      fakePool([{ credentials_ciphertext: ciphertext }]),
    );

    await expect(reader.readMattermostTarget(EXTERNAL_ID)).resolves.toMatchObject({ token: TOKEN });
  });

  it('fails clearly when the connection has no sealed credential', async () => {
    const reader = createCommunityCredentialsReader(
      { databaseUrl: 'postgresql://unused', keyring: KEYRING },
      fakePool([]),
    );

    await expect(reader.readMattermostTarget(EXTERNAL_ID)).rejects.toThrow(/No sealed credential/);
  });

  it('rejects a ciphertext copied from another connection', async () => {
    const foreign = sealCommunityCredential(
      KEYRING,
      { platform: 'mattermost', externalId: 'https://other.example.com/team-9' },
      TOKEN,
    );
    const reader = createCommunityCredentialsReader(
      { databaseUrl: 'postgresql://unused', keyring: KEYRING },
      fakePool([{ credentials_ciphertext: foreign }]),
    );

    await expect(reader.readMattermostTarget(EXTERNAL_ID)).rejects.toThrow(/failed authentication/);
  });

  it('closes its pool', async () => {
    const pool = fakePool([]);
    const reader = createCommunityCredentialsReader({ databaseUrl: 'postgresql://unused', keyring: KEYRING }, pool);

    await reader.close();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});

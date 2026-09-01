import { sealCommunityCredential } from '@reputo/community-api';
import { describe, expect, it } from 'vitest';
import { openMattermostTarget } from '../../../../src/activities/community/credentials.js';

const KEYRING = { currentSecret: 'workflow-credentials-test-key-0123456789abcdef' };
const EXTERNAL_ID = 'https://chat.example.com:8065/team-1';
const TOKEN = 'mm-worker-token';

const seal = (externalId: string, keyring = KEYRING) =>
  sealCommunityCredential(keyring, { platform: 'mattermost', externalId }, TOKEN);

describe('openMattermostTarget', () => {
  it('splits the connection id and unseals the token', () => {
    const target = openMattermostTarget(KEYRING, EXTERNAL_ID, seal(EXTERNAL_ID));

    expect(target).toEqual({ serverUrl: 'https://chat.example.com:8065', teamId: 'team-1', token: TOKEN });
  });

  it('opens envelopes sealed under the previous key after rotation', () => {
    const envelope = seal(EXTERNAL_ID);
    const rotated = {
      currentSecret: 'workflow-credentials-rotated-key-0123456789abcd',
      previousSecret: KEYRING.currentSecret,
    };

    expect(openMattermostTarget(rotated, EXTERNAL_ID, envelope).token).toBe(TOKEN);
  });

  it('rejects an envelope sealed for another connection', () => {
    const foreign = seal('https://other.example.com/team-9');

    expect(() => openMattermostTarget(KEYRING, EXTERNAL_ID, foreign)).toThrow(/failed authentication/);
  });

  it('rejects a connection id that is not {origin}/{teamId}', () => {
    expect(() => openMattermostTarget(KEYRING, 'not-an-origin', seal(EXTERNAL_ID))).toThrow(/{origin}\/{teamId}/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CommunityCredentialError,
  type CommunityCredentialKeyring,
  openCommunityCredential,
  sealCommunityCredential,
} from '../../../src/shared/credentials.js';

const CURRENT_SECRET = 'current-secret-0123456789abcdef-0123456789abcdef';
const NEXT_SECRET = 'next-secret-0123456789abcdef-0123456789abcdefgh';

const keyring: CommunityCredentialKeyring = { currentSecret: CURRENT_SECRET };
const binding = { platform: 'mattermost', externalId: 'https://chat.example.com/team-1' };
const TOKEN = 'mm-bot-token-value';

describe('sealCommunityCredential', () => {
  it('round-trips through a ccv1 envelope with a key id', () => {
    const envelope = sealCommunityCredential(keyring, binding, TOKEN);

    const segments = envelope.split(':');
    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe('ccv1');
    expect(segments[1]).toHaveLength(8);
    expect(envelope).not.toContain(TOKEN);

    expect(openCommunityCredential(keyring, binding, envelope)).toBe(TOKEN);
  });

  it('produces a fresh envelope per seal, so equal tokens are not linkable', () => {
    const first = sealCommunityCredential(keyring, binding, TOKEN);
    const second = sealCommunityCredential(keyring, binding, TOKEN);

    expect(first).not.toBe(second);
    expect(openCommunityCredential(keyring, binding, second)).toBe(TOKEN);
  });

  it('refuses a secret shorter than 32 characters', () => {
    expect(() => sealCommunityCredential({ currentSecret: 'short' }, binding, TOKEN)).toThrow(CommunityCredentialError);
  });
});

describe('openCommunityCredential', () => {
  it('opens an envelope sealed under the previous key after rotation', () => {
    const envelope = sealCommunityCredential({ currentSecret: CURRENT_SECRET }, binding, TOKEN);
    const rotated: CommunityCredentialKeyring = { currentSecret: NEXT_SECRET, previousSecret: CURRENT_SECRET };

    expect(openCommunityCredential(rotated, binding, envelope)).toBe(TOKEN);
  });

  it('names the key it cannot find once the sealing key left the keyring', () => {
    const envelope = sealCommunityCredential({ currentSecret: CURRENT_SECRET }, binding, TOKEN);

    expect(() => openCommunityCredential({ currentSecret: NEXT_SECRET }, binding, envelope)).toThrow(
      /key this deployment does not hold/,
    );
  });

  it('rejects a ciphertext swapped onto another connection (AAD binding)', () => {
    const envelope = sealCommunityCredential(keyring, binding, TOKEN);
    const otherRow = { platform: 'mattermost', externalId: 'https://chat.example.com/team-2' };

    expect(() => openCommunityCredential(keyring, otherRow, envelope)).toThrow(/failed authentication/);
  });

  it('rejects a tampered ciphertext', () => {
    const envelope = sealCommunityCredential(keyring, binding, TOKEN);
    const segments = envelope.split(':');
    const flipped = Buffer.from(segments[4], 'base64url');
    flipped[0] ^= 0xff;
    segments[4] = flipped.toString('base64url');

    expect(() => openCommunityCredential(keyring, binding, segments.join(':'))).toThrow(/failed authentication/);
  });

  it('rejects an envelope that is not ccv1-shaped', () => {
    for (const envelope of ['', 'ccv1:only-two', 'ccv2:a:b:c:d', 'plaintext-token']) {
      expect(() => openCommunityCredential(keyring, binding, envelope)).toThrow(/not a ccv1 envelope/);
    }
  });
});

import type { ConfigService } from '@nestjs/config';
import { CommunityPlatform } from '@reputo/contracts';
import { describe, expect, it } from 'vitest';
import { CommunityInstallStateService } from '../../../src/community';

const TTL_SECONDS = 600;

function createService(secret = 'install-state-secret-value-0123456789'): CommunityInstallStateService {
  const configService = {
    get: (key: string) => (key === 'auth.tokenEncryptionKey' ? secret : TTL_SECONDS),
  } as unknown as ConfigService;

  return new CommunityInstallStateService(configService);
}

describe('CommunityInstallStateService', () => {
  const service = createService();
  const now = new Date('2026-08-26T10:00:00.000Z');

  it('accepts a freshly issued state for the platform it was minted for', () => {
    const state = service.issue(CommunityPlatform.discord, now);

    expect(service.verify(state, CommunityPlatform.discord, now)).toBe(true);
  });

  it('issues a different value every time', () => {
    const first = service.issue(CommunityPlatform.discord, now);
    const second = service.issue(CommunityPlatform.discord, now);

    expect(first).not.toBe(second);
  });

  it('rejects a state past its TTL', () => {
    const state = service.issue(CommunityPlatform.discord, now);
    const justInside = new Date(now.getTime() + TTL_SECONDS * 1000 - 1);
    const justOutside = new Date(now.getTime() + TTL_SECONDS * 1000 + 1);

    expect(service.verify(state, CommunityPlatform.discord, justInside)).toBe(true);
    expect(service.verify(state, CommunityPlatform.discord, justOutside)).toBe(false);
  });

  it('rejects a state minted for another platform', () => {
    const state = service.issue(CommunityPlatform.github, now);

    expect(service.verify(state, CommunityPlatform.discord, now)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const [encoded, signature] = service.issue(CommunityPlatform.discord, now).split('.');
    const forged = Buffer.from(
      JSON.stringify({ p: 'discord', n: 'forged', e: now.getTime() + 60_000 }),
      'utf8',
    ).toString('base64url');

    expect(service.verify(`${forged}.${signature}`, CommunityPlatform.discord, now)).toBe(false);
    expect(service.verify(`${encoded}.${signature}x`, CommunityPlatform.discord, now)).toBe(false);
  });

  it('rejects a state signed with a different key', () => {
    const state = createService('another-secret-value-9876543210abcd').issue(CommunityPlatform.discord, now);

    expect(service.verify(state, CommunityPlatform.discord, now)).toBe(false);
  });

  it('rejects missing and malformed values', () => {
    for (const value of [undefined, '', 'no-separator', '.', 'a.b', `${'!'.repeat(8)}.sig`]) {
      expect(service.verify(value, CommunityPlatform.discord, now)).toBe(false);
    }
  });
});

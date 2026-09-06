import { CommunityErrorCategory } from '@reputo/community-api';
import { CommunityConnectionStatus } from '@reputo/contracts';
import { describe, expect, it } from 'vitest';
import { CommunityLocalErrorCategory, describeErrorCategory, statusForFailure } from '../../../src/community';

describe('statusForFailure', () => {
  it('breaks the connection when the credentials, permissions, or target are the problem', () => {
    for (const category of [
      CommunityErrorCategory.authFailed,
      CommunityErrorCategory.permissionDenied,
      CommunityErrorCategory.notFound,
      CommunityErrorCategory.outboundPolicy,
    ]) {
      expect(statusForFailure(category)).toBe(CommunityConnectionStatus.broken);
    }
  });

  it('only degrades the connection on a transient failure', () => {
    for (const category of [
      CommunityErrorCategory.rateLimited,
      CommunityErrorCategory.networkError,
      CommunityErrorCategory.upstreamError,
      CommunityErrorCategory.contractViolation,
      CommunityLocalErrorCategory.invalidState,
    ]) {
      expect(statusForFailure(category)).toBe(CommunityConnectionStatus.degraded);
    }
  });
});

describe('describeErrorCategory', () => {
  it('describes every category the platform clients raise', () => {
    for (const category of Object.values(CommunityErrorCategory)) {
      expect(describeErrorCategory(category)).not.toBe('The last check did not succeed.');
    }
  });

  it('describes the categories the API adds', () => {
    for (const category of Object.values(CommunityLocalErrorCategory)) {
      expect(describeErrorCategory(category)).not.toBe('The last check did not succeed.');
    }
  });

  it('tells a kicked bot from a deleted community on every platform', () => {
    // A kicked bot is answered with 404 as often as with 403, so the notFound
    // wording has to name reconnecting as the fix rather than blaming a
    // deletion the admin cannot act on.
    for (const platform of ['discord', 'github', 'mattermost'] as const) {
      const reason = describeErrorCategory(CommunityErrorCategory.notFound, platform);
      expect(reason).not.toBe(describeErrorCategory(CommunityErrorCategory.notFound));
      expect(reason).toMatch(/no longer|could not be found/i);
    }
    expect(describeErrorCategory(CommunityErrorCategory.notFound, 'discord')).toMatch(/reconnect/i);
  });

  it('falls back to a safe sentence for an unknown category', () => {
    expect(describeErrorCategory('something_new')).toBe('The last check did not succeed.');
  });

  it('never leaks a platform response body', () => {
    const reasons = Object.values(CommunityErrorCategory).flatMap((category) => [
      describeErrorCategory(category),
      describeErrorCategory(category, 'discord'),
      describeErrorCategory(category, 'github'),
    ]);

    for (const reason of reasons) {
      expect(reason).not.toMatch(/HTTP \d{3}|token|secret/i);
    }
  });

  it('names what the admin must re-grant on that platform', () => {
    expect(describeErrorCategory(CommunityErrorCategory.permissionDenied, 'discord')).toContain(
      'View Channels or Read Message History',
    );
    expect(describeErrorCategory(CommunityErrorCategory.permissionDenied, 'github')).toContain('GitHub App');
    expect(describeErrorCategory(CommunityErrorCategory.permissionDenied, 'mattermost')).toContain('Invite it');
    expect(describeErrorCategory(CommunityErrorCategory.rateLimited, 'github')).toBe(
      describeErrorCategory(CommunityErrorCategory.rateLimited),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { type CommunityResource, digestCommunityResources } from '../../../src/shared/types.js';

const channel = (overrides: Partial<CommunityResource> = {}): CommunityResource => ({
  id: '1',
  name: 'general',
  kind: 'channel',
  readable: true,
  ...overrides,
});

describe('digestCommunityResources', () => {
  it('ignores the order the platform listed the resources in', () => {
    const first = channel();
    const second = channel({ id: '2', name: 'random' });

    expect(digestCommunityResources([first, second])).toBe(digestCommunityResources([second, first]));
  });

  it('changes when a resource is renamed, which leaves every count untouched', () => {
    expect(digestCommunityResources([channel()])).not.toBe(digestCommunityResources([channel({ name: 'lobby' })]));
  });

  it('changes when a resource turns unreadable', () => {
    const blocked = channel({ readable: false, accessIssue: 'missing_view_channel' });

    expect(digestCommunityResources([channel()])).not.toBe(digestCommunityResources([blocked]));
  });

  // The row a probe writes is otherwise identical here — same counts, same
  // readable verdict — so the digest is the only thing that can tell a picker
  // its remediation now names a different permission.
  it('changes when an unreadable resource is blocked by a different permission', () => {
    const cannotView = channel({ readable: false, accessIssue: 'missing_view_channel' });
    const noHistory = channel({ readable: false, accessIssue: 'missing_read_history' });

    expect(digestCommunityResources([cannotView])).not.toBe(digestCommunityResources([noHistory]));
  });
});

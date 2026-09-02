import { describe, expect, it } from 'vitest';
import {
  buildMattermostExternalId,
  countMattermostPosts,
  normalizeMattermostServerUrl,
  parseMattermostExternalId,
  toMattermostResources,
  toMattermostTeamProfile,
  toMattermostTeams,
} from '../../../src/mattermost/transform.js';
import { CommunityContractError, CommunityOutboundPolicyError } from '../../../src/shared/errors.js';

describe('normalizeMattermostServerUrl', () => {
  it('keeps scheme and port and drops path, query, and whitespace', () => {
    expect(normalizeMattermostServerUrl('  https://chat.example.com:8065/login?next=1 ')).toBe(
      'https://chat.example.com:8065',
    );
    expect(normalizeMattermostServerUrl('http://mattermost:8065/')).toBe('http://mattermost:8065');
  });

  it('rejects non-URL input and non-http schemes', () => {
    expect(() => normalizeMattermostServerUrl('chat.example.com')).toThrow(CommunityOutboundPolicyError);
    expect(() => normalizeMattermostServerUrl('ws://chat.example.com')).toThrow(CommunityOutboundPolicyError);
  });
});

describe('external id', () => {
  it('keys the connection on origin plus team, so http and https never collide', () => {
    const https = buildMattermostExternalId('https://chat.example.com', 'team-1');
    const http = buildMattermostExternalId('http://chat.example.com', 'team-1');

    expect(https).toBe('https://chat.example.com/team-1');
    expect(http).toBe('http://chat.example.com/team-1');
    expect(https).not.toBe(http);
  });

  it('round-trips through parse', () => {
    const externalId = buildMattermostExternalId('https://chat.example.com:8443/some/path', 'abc123');

    expect(parseMattermostExternalId(externalId)).toEqual({
      serverUrl: 'https://chat.example.com:8443',
      teamId: 'abc123',
    });
  });

  it('rejects ids that are not {origin}/{teamId}', () => {
    for (const externalId of ['', 'team-only', 'https://chat.example.com/', 'https:///team']) {
      expect(() => parseMattermostExternalId(externalId)).toThrow(CommunityContractError);
    }
  });
});

describe('toMattermostTeams', () => {
  it('keeps active teams and falls back through the naming fields', () => {
    const teams = toMattermostTeams([
      { id: 't1', name: 'snet', display_name: 'SingularityNET', delete_at: 0 },
      { id: 't2', name: 'archived', display_name: 'Archived', delete_at: 1700000000000 },
      { id: 't3', name: 'no-display', display_name: '' },
      { id: '', name: 'invalid' },
    ]);

    expect(teams).toEqual([
      { id: 't1', name: 'snet', displayName: 'SingularityNET' },
      { id: 't3', name: 'no-display', displayName: 'no-display' },
    ]);
  });

  it('rejects a non-array listing', () => {
    expect(() => toMattermostTeams({ nope: true })).toThrow(CommunityContractError);
  });
});

describe('toMattermostResources', () => {
  it('keeps open and private channels, drops the rest, and sorts by shown name', () => {
    const resources = toMattermostResources([
      { id: 'c2', name: 'town-square', display_name: 'Town Square', type: 'O', delete_at: 0 },
      { id: 'c1', name: 'backstage', display_name: 'Backstage', type: 'P', delete_at: 0 },
      { id: 'c3', name: 'dm', display_name: '', type: 'D', delete_at: 0 },
      { id: 'c4', name: 'gone', display_name: 'Gone', type: 'O', delete_at: 1700000000000 },
    ]);

    expect(resources).toEqual([
      { id: 'c1', name: 'Backstage', kind: 'text' },
      { id: 'c2', name: 'Town Square', kind: 'text' },
    ]);
  });
});

describe('countMattermostPosts', () => {
  it('counts the page and verifies the fields the fetch will need', () => {
    expect(
      countMattermostPosts({
        order: ['p1', 'p2'],
        posts: {
          p1: { id: 'p1', user_id: 'u1', create_at: 1700000000000 },
          p2: { id: 'p2', user_id: 'u2', create_at: 1700000000001 },
        },
      }),
    ).toBe(2);
    expect(countMattermostPosts({ order: [], posts: {} })).toBe(0);
  });

  it('rejects posts missing an id, author, or timestamp', () => {
    expect(() => countMattermostPosts({ order: ['p1'], posts: { p1: { id: 'p1', user_id: 'u1' } } })).toThrow(
      CommunityContractError,
    );
  });

  it('rejects a malformed page', () => {
    expect(() => countMattermostPosts({ order: 'p1' } as never)).toThrow(CommunityContractError);
  });
});

describe('toMattermostTeamProfile', () => {
  it('prefers the active member count and falls back to the total', () => {
    expect(toMattermostTeamProfile({ total_member_count: 12, active_member_count: 9 })).toEqual({ memberCount: 9 });
    expect(toMattermostTeamProfile({ total_member_count: 12 })).toEqual({ memberCount: 12 });
  });

  it('leaves absent or malformed counts undefined', () => {
    expect(toMattermostTeamProfile({}).memberCount).toBeUndefined();
    expect(toMattermostTeamProfile({ active_member_count: 'nine' }).memberCount).toBeUndefined();
    expect(toMattermostTeamProfile({ total_member_count: Number.NaN }).memberCount).toBeUndefined();
  });
});

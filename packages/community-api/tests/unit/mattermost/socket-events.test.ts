import { describe, expect, it } from 'vitest';
import { readMattermostEvent } from '../../../src/mattermost/transform.js';

const TEAM = 'team-1';
const BOT = 'bot-user-1';
const scope = { teamId: TEAM, botUserId: BOT };

describe('readMattermostEvent', () => {
  it.each([
    'channel_created',
    'channel_deleted',
    'channel_restored',
    'channel_updated',
    'channel_converted',
  ])('reads %s as a resource change', (event) => {
    expect(readMattermostEvent({ event, data: { team_id: TEAM } }, scope)).toBe('resources');
  });

  it('reads the bot being invited to a channel as a resource change', () => {
    expect(readMattermostEvent({ event: 'user_added', data: { user_id: BOT, team_id: TEAM } }, scope)).toBe(
      'resources',
    );
  });

  it('drops a membership event about anybody but the bot', () => {
    expect(
      readMattermostEvent({ event: 'user_added', data: { user_id: 'someone-else', team_id: TEAM } }, scope),
    ).toBeNull();
    expect(readMattermostEvent({ event: 'user_removed', broadcast: { user_id: 'someone-else' } }, scope)).toBeNull();
  });

  it('lets membership events through while the bot identity is unknown, so no change is missed', () => {
    expect(readMattermostEvent({ event: 'user_added', data: { user_id: 'someone-else' } }, { teamId: TEAM })).toBe(
      'resources',
    );
  });

  it('reads leaving or losing the team as revoked access', () => {
    expect(readMattermostEvent({ event: 'leave_team', broadcast: { team_id: TEAM } }, scope)).toBe('revoked');
    expect(readMattermostEvent({ event: 'delete_team', data: { team_id: TEAM } }, scope)).toBe('revoked');
  });

  it('reads a team update as a community change', () => {
    expect(readMattermostEvent({ event: 'update_team', data: { team_id: TEAM } }, scope)).toBe('community');
  });

  it('drops frames about another team on the same server', () => {
    expect(readMattermostEvent({ event: 'channel_created', data: { team_id: 'other-team' } }, scope)).toBeNull();
    expect(readMattermostEvent({ event: 'leave_team', broadcast: { team_id: 'other-team' } }, scope)).toBeNull();
  });

  it('accepts a server-wide frame that names no team', () => {
    expect(readMattermostEvent({ event: 'channel_updated' }, scope)).toBe('resources');
  });

  it('never reads a post frame, so no message content is touched', () => {
    expect(readMattermostEvent({ event: 'posted', data: { post: '{"message":"hello"}' } }, scope)).toBeNull();
    expect(readMattermostEvent({ event: 'typing', broadcast: { channel_id: 'c1' } }, scope)).toBeNull();
    expect(readMattermostEvent({ event: 'reaction_added', data: { team_id: TEAM } }, scope)).toBeNull();
  });

  it('ignores a frame with no event name', () => {
    expect(readMattermostEvent({ data: { team_id: TEAM } }, scope)).toBeNull();
  });
});

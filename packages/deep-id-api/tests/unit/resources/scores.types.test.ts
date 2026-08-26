import { describe, expect, it } from 'vitest';
import { plainScoreEntrySchema } from '../../../src/resources/scores/schemas.js';
import { SCORE_TYPES } from '../../../src/resources/scores/types.js';

const TS = '2026-08-26T10:00:00Z';

describe('SCORE_TYPES', () => {
  it('carries the community engagement types', () => {
    expect(SCORE_TYPES).toContain('github_engagement');
    expect(SCORE_TYPES).toContain('discord_engagement');
    expect(SCORE_TYPES).toContain('mattermost_engagement');
  });

  it('keeps the existing types unchanged', () => {
    expect(SCORE_TYPES).toContain('voting_engagement');
    expect(SCORE_TYPES).toContain('contribution_score');
    expect(SCORE_TYPES).toContain('proposal_engagement');
    expect(SCORE_TYPES).toContain('token_value_over_time');
    expect(SCORE_TYPES).toContain('custom_score');
  });

  it('has no duplicate entries', () => {
    expect(new Set(SCORE_TYPES).size).toBe(SCORE_TYPES.length);
  });
});

describe('plainScoreEntrySchema', () => {
  it.each([
    'github_engagement',
    'discord_engagement',
    'mattermost_engagement',
  ] as const)('accepts a %s entry, including an explicit zero', (type) => {
    expect(plainScoreEntrySchema.safeParse({ score: 0, type, timestamp: TS }).success).toBe(true);
  });

  it('still rejects an unregistered score type', () => {
    expect(plainScoreEntrySchema.safeParse({ score: 1, type: 'telegram_engagement', timestamp: TS }).success).toBe(
      false,
    );
  });
});

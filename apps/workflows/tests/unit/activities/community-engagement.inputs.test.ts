import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/index.js', () => ({
  default: { storage: { bucket: 'test' }, logger: { level: 'silent' }, app: { nodeEnv: 'production' } },
}));

import { extractActivityWeights } from '../../../src/activities/typescript/algorithms/community-engagement/inputs.js';
import { roundPoints } from '../../../src/activities/typescript/algorithms/community-engagement/types.js';
import { DISCORD_ACTIVITY_TYPES } from '../../../src/activities/typescript/algorithms/discord-engagement/index.js';

const inputsWith = (activities: unknown) => [{ key: 'activities', value: activities }];

describe('extractActivityWeights', () => {
  it('returns configured activities in the canonical order regardless of row order', () => {
    const weights = extractActivityWeights(
      inputsWith([
        { activity: 'active_day', points: 2, daily_cap: 30 },
        { activity: 'message', points: 1, daily_cap: 25 },
      ]),
      DISCORD_ACTIVITY_TYPES,
    );

    expect([...weights.entries()]).toEqual([
      ['message', { points: 1, dailyCap: 25 }],
      ['active_day', { points: 2, dailyCap: 30 }],
    ]);
  });

  it('rejects a missing or empty activities input', () => {
    expect(() => extractActivityWeights([], DISCORD_ACTIVITY_TYPES)).toThrow(/activities/);
    expect(() => extractActivityWeights(inputsWith([]), DISCORD_ACTIVITY_TYPES)).toThrow(/activities/);
  });

  it('rejects unknown and duplicated activities', () => {
    expect(() =>
      extractActivityWeights(inputsWith([{ activity: 'boost', points: 1, daily_cap: 1 }]), DISCORD_ACTIVITY_TYPES),
    ).toThrow(/Unknown activity/);
    expect(() =>
      extractActivityWeights(
        inputsWith([
          { activity: 'message', points: 1, daily_cap: 1 },
          { activity: 'message', points: 2, daily_cap: 1 },
        ]),
        DISCORD_ACTIVITY_TYPES,
      ),
    ).toThrow(/more than once/);
  });

  it('rejects non-positive points — zero weight is invalid app-wide', () => {
    for (const points of [0, -1, Number.NaN, 'high', undefined]) {
      expect(() =>
        extractActivityWeights(inputsWith([{ activity: 'message', points, daily_cap: 5 }]), DISCORD_ACTIVITY_TYPES),
      ).toThrow(/points greater than 0/);
    }
  });

  it('rejects a daily cap below 1 or non-integer', () => {
    for (const cap of [0, -3, 1.5, 'many', undefined]) {
      expect(() =>
        extractActivityWeights(
          inputsWith([{ activity: 'message', points: 1, daily_cap: cap }]),
          DISCORD_ACTIVITY_TYPES,
        ),
      ).toThrow(/daily_cap/);
    }
  });
});

describe('roundPoints', () => {
  it('keeps weighted sums free of float artifacts', () => {
    expect(roundPoints(0.1 + 0.2)).toBe(0.3);
    expect(roundPoints(3 * 0.25)).toBe(0.75);
    expect(roundPoints(7)).toBe(7);
  });
});

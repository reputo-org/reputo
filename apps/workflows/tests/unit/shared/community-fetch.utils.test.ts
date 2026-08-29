import { describe, expect, it } from 'vitest';
import { extractCommunityFetchInput } from '../../../src/shared/utils/community-fetch.utils.js';

const WORKFLOW_START = new Date('2026-08-29T10:30:00.000Z');

const preset = (inputs: Array<{ key: string; value?: unknown }>) => ({ key: 'discord_engagement', inputs });

describe('extractCommunityFetchInput', () => {
  it('fixes the window to [start − lookback_days, start) from the workflow start time', () => {
    const input = extractCommunityFetchInput(
      preset([
        { key: 'lookback_days', value: 90 },
        { key: 'resources', value: ['111', '222'] },
      ]),
      WORKFLOW_START,
    );

    expect(input).toEqual({
      resourceIds: ['111', '222'],
      windowStart: '2026-05-31T10:30:00.000Z',
      windowEnd: '2026-08-29T10:30:00.000Z',
    });
  });

  it('deduplicates repeated resource ids while keeping their order', () => {
    const input = extractCommunityFetchInput(
      preset([
        { key: 'lookback_days', value: 1 },
        { key: 'resources', value: ['222', '111', '222'] },
      ]),
      WORKFLOW_START,
    );

    expect(input.resourceIds).toEqual(['222', '111']);
  });

  it('accepts the 183-day maximum and rejects anything past it', () => {
    const inputs = (lookback: unknown) =>
      preset([
        { key: 'lookback_days', value: lookback },
        { key: 'resources', value: ['111'] },
      ]);

    expect(extractCommunityFetchInput(inputs(183), WORKFLOW_START).windowStart).toBe('2026-02-27T10:30:00.000Z');
    expect(() => extractCommunityFetchInput(inputs(184), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(inputs(0), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(inputs(7.5), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(inputs('90'), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(preset([{ key: 'resources', value: ['111'] }]), WORKFLOW_START)).toThrow(
      /lookback_days/,
    );
  });

  it('rejects a missing, empty, or malformed resources input', () => {
    const inputs = (resources?: unknown) =>
      preset([
        { key: 'lookback_days', value: 30 },
        ...(resources === undefined ? [] : [{ key: 'resources', value: resources }]),
      ]);

    expect(() => extractCommunityFetchInput(inputs(), WORKFLOW_START)).toThrow(/resources/);
    expect(() => extractCommunityFetchInput(inputs([]), WORKFLOW_START)).toThrow(/resources/);
    expect(() => extractCommunityFetchInput(inputs([111]), WORKFLOW_START)).toThrow(/resources/);
    expect(() => extractCommunityFetchInput(inputs('111'), WORKFLOW_START)).toThrow(/resources/);
  });
});

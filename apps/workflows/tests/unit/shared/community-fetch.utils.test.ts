import { describe, expect, it } from 'vitest';
import { extractCommunityFetchInput } from '../../../src/shared/utils/community-fetch.utils.js';

const WORKFLOW_START = new Date('2026-08-29T10:30:00.000Z');

const CONNECTION_ID = '01990000-0000-7000-8000-000000000001';

const preset = (inputs: Array<{ key: string; value?: unknown }>) => ({ key: 'discord_engagement', inputs });

const baseInputs = (overrides: Array<{ key: string; value?: unknown }> = []) => {
  const inputs = [
    { key: 'community_connection_id', value: CONNECTION_ID },
    { key: 'lookback_days', value: 90 },
    { key: 'resources', value: ['111', '222'] },
  ];
  for (const override of overrides) {
    const index = inputs.findIndex((input) => input.key === override.key);
    if (index === -1) {
      inputs.push(override);
    } else {
      inputs[index] = override;
    }
  }
  return inputs;
};

describe('extractCommunityFetchInput', () => {
  it('fixes the window to [start − lookback_days, start) from the workflow start time', () => {
    const input = extractCommunityFetchInput(preset(baseInputs()), WORKFLOW_START);

    expect(input).toEqual({
      connectionId: CONNECTION_ID,
      resourceIds: ['111', '222'],
      windowStart: '2026-05-31T10:30:00.000Z',
      windowEnd: '2026-08-29T10:30:00.000Z',
    });
  });

  it('deduplicates repeated resource ids while keeping their order', () => {
    const input = extractCommunityFetchInput(
      preset(baseInputs([{ key: 'resources', value: ['222', '111', '222'] }])),
      WORKFLOW_START,
    );

    expect(input.resourceIds).toEqual(['222', '111']);
  });

  it('accepts the 183-day maximum and rejects anything past it', () => {
    const inputs = (lookback: unknown) => preset(baseInputs([{ key: 'lookback_days', value: lookback }]));

    expect(extractCommunityFetchInput(inputs(183), WORKFLOW_START).windowStart).toBe('2026-02-27T10:30:00.000Z');
    expect(() => extractCommunityFetchInput(inputs(184), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(inputs(0), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(inputs(7.5), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(inputs('90'), WORKFLOW_START)).toThrow(/lookback_days/);
    expect(() => extractCommunityFetchInput(inputs(undefined), WORKFLOW_START)).toThrow(/lookback_days/);
  });

  it('rejects a missing, empty, or malformed resources input', () => {
    const inputs = (resources?: unknown) => preset(baseInputs([{ key: 'resources', value: resources }]));

    expect(() => extractCommunityFetchInput(inputs(undefined), WORKFLOW_START)).toThrow(/resources/);
    expect(() => extractCommunityFetchInput(inputs([]), WORKFLOW_START)).toThrow(/resources/);
    expect(() => extractCommunityFetchInput(inputs([111]), WORKFLOW_START)).toThrow(/resources/);
    expect(() => extractCommunityFetchInput(inputs('111'), WORKFLOW_START)).toThrow(/resources/);
  });

  it('rejects a missing or empty community connection input', () => {
    expect(() =>
      extractCommunityFetchInput(
        preset(baseInputs([{ key: 'community_connection_id', value: undefined }])),
        WORKFLOW_START,
      ),
    ).toThrow(/community_connection_id/);
    expect(() =>
      extractCommunityFetchInput(preset(baseInputs([{ key: 'community_connection_id', value: '  ' }])), WORKFLOW_START),
    ).toThrow(/community_connection_id/);
  });
});

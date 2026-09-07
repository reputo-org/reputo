import { describe, expect, it } from 'vitest';
import { algorithmPresetInputSchema, validateCreateAlgorithmPreset } from '../../src/schemas/algorithm-preset.js';

describe('algorithm preset schemas', () => {
  it('accepts a valid preset payload with optional metadata', () => {
    const result = validateCreateAlgorithmPreset({
      key: 'voting_engagement',
      version: '1.0.0',
      inputs: [{ key: 'threshold', value: 0.5 }],
      name: 'Voting Engagement',
      description: 'Calculates engagement based on voting patterns.',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      key: 'voting_engagement',
      version: '1.0.0',
      inputs: [{ key: 'threshold', value: 0.5 }],
      name: 'Voting Engagement',
      description: 'Calculates engagement based on voting patterns.',
    });
  });

  it('rejects missing keys, null values, and empty input arrays', () => {
    const inputResult = algorithmPresetInputSchema.safeParse({
      key: '',
      value: null,
    });
    const presetResult = validateCreateAlgorithmPreset({
      key: '',
      version: '',
      inputs: [],
      name: 'No',
      description: 'Too short',
    });

    expect(inputResult.success).toBe(false);
    if (inputResult.success) {
      throw new Error('Expected invalid preset input');
    }
    expect(inputResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Input key is required.' }),
        expect.objectContaining({ message: 'Input value is required.' }),
      ]),
    );

    expect(presetResult.success).toBe(false);
    if (presetResult.success) {
      throw new Error('Expected invalid preset payload');
    }
    expect(presetResult.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Algorithm key is required.' }),
        expect.objectContaining({ message: 'Algorithm version is required.' }),
        expect.objectContaining({ message: 'At least one input is required.' }),
        expect.objectContaining({ message: 'Name must be at least 3 characters.' }),
        expect.objectContaining({ message: 'Description must be at least 10 characters.' }),
      ]),
    );
  });
});

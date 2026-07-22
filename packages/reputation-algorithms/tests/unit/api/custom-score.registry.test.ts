import { describe, expect, it } from 'vitest';
import {
  getAlgorithmDefinition,
  getAlgorithmDefinitionKeys,
  getAlgorithmDefinitionVersions,
} from '../../../src/api/registry.js';
import type { AlgorithmDefinition } from '../../../src/shared/types/algorithm.js';
import { createValidatorWithSchema } from '../../../src/shared/utils/validation.js';

describe('custom_score registry loading', () => {
  it('loads custom_score from the generated registry index', () => {
    const keys = getAlgorithmDefinitionKeys();
    const versions = getAlgorithmDefinitionVersions('custom_score');
    const definition = JSON.parse(
      getAlgorithmDefinition({
        key: 'custom_score',
        version: '1.0.0',
      }),
    ) as AlgorithmDefinition;

    expect(keys).toContain('custom_score');
    expect(versions).toEqual(['1.0.0']);
    expect(definition).toMatchObject({
      key: 'custom_score',
      version: '1.0.0',
      kind: 'combined',
      runtime: 'typescript',
    });
    expect(definition.inputs).toEqual([
      expect.objectContaining({
        key: 'sub_algorithms',
        type: 'sub_algorithm',
        uiHint: expect.objectContaining({
          widget: 'sub_algorithm_composer',
        }),
      }),
    ]);
    expect(definition.outputs).toEqual([
      expect.objectContaining({
        key: 'custom_score_details',
        type: 'json',
      }),
    ]);
  });

  it('declares observed min-max normalization into the fixed 0-100 target range', () => {
    const definition = JSON.parse(
      getAlgorithmDefinition({
        key: 'custom_score',
        version: '1.0.0',
      }),
    ) as AlgorithmDefinition;

    expect(definition.normalization).toEqual({
      method: 'observed_min_max',
      targetMin: 0,
      targetMax: 100,
    });
  });

  it('describes the encrypted scoring flow without a source-range input', () => {
    const definition = JSON.parse(
      getAlgorithmDefinition({
        key: 'custom_score',
        version: '1.0.0',
      }),
    ) as AlgorithmDefinition;

    // Copy anchors for the encrypted flow: DeepID owns identity mapping, only
    // complete unified users are evaluated, and the final score is custom_score_encr.
    expect(definition.description).toContain('DeepID');
    expect(definition.description).toContain('custom_score_encr');
    expect(definition.description).toContain('native cohort');
    expect(definition.summary).toContain('encrypted');

    // Normalization stays definition metadata: no preset input and no source min/max inputs.
    expect(definition.inputs.map((input) => input.key)).toEqual(['sub_algorithms']);
  });

  it('remains schema-valid when loaded through the public registry API', () => {
    const validator = createValidatorWithSchema();
    const definition = JSON.parse(
      getAlgorithmDefinition({
        key: 'custom_score',
      }),
    ) as AlgorithmDefinition;

    const result = validator.validate(definition);

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

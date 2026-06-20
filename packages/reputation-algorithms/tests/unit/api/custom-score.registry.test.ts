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
    expect(definition.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'sub_algorithms',
          type: 'sub_algorithm',
          uiHint: expect.objectContaining({
            widget: 'sub_algorithm_composer',
          }),
        }),
        expect.objectContaining({
          key: 'missing_score_strategy',
          enum: ['exclude', 'zero'],
        }),
      ]),
    );
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

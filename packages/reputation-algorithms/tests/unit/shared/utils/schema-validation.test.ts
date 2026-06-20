import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AlgorithmValidator, createValidatorWithSchema } from '../../../../src/shared/utils/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Build: Schema Validation', () => {
  let validator: AlgorithmValidator;

  beforeEach(() => {
    validator = createValidatorWithSchema();
  });

  describe('Valid Fixtures', () => {
    it('should validate sample-algorithm.json', () => {
      const fixturePath = join(__dirname, '../../../fixtures/valid/sample-algorithm.json');
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const result = validator.validate(fixture);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate voting_engagement from registry', () => {
      const algorithmPath = join(__dirname, '../../../../src/registry/voting_engagement/1.0.0.json');
      const algorithm = JSON.parse(readFileSync(algorithmPath, 'utf-8'));

      const result = validator.validate(algorithm);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate token_value_over_time from registry', () => {
      const algorithmPath = join(__dirname, '../../../../src/registry/token_value_over_time/1.0.0.json');
      const algorithm = JSON.parse(readFileSync(algorithmPath, 'utf-8'));

      const result = validator.validate(algorithm);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate custom_score from registry', () => {
      const algorithmPath = join(__dirname, '../../../../src/registry/custom_score/1.0.0.json');
      const algorithm = JSON.parse(readFileSync(algorithmPath, 'utf-8'));

      const result = validator.validate(algorithm);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate resource selector inputs and root validation rules', () => {
      const resourceSelectorDefinition = {
        key: 'chain_resource_selector',
        name: 'Chain Resource Selector',
        category: 'Activity',
        summary: 'Validates resource selector metadata.',
        description: 'Uses a resource selector input and root validation rules.',
        version: '1.0.0',
        inputs: [
          {
            key: 'wallets',
            label: 'Wallet Addresses JSON',
            description: 'Wallet input',
            type: 'json',
            required: true,
            json: {
              maxBytes: 1024,
              schema: 'wallet_address_map',
              rootKey: 'wallets',
              allowedChains: ['ethereum', 'cardano'],
            },
          },
          {
            key: 'selected_resources',
            label: 'Resources',
            description: 'Chain-scoped resource selections.',
            type: 'array',
            minItems: 1,
            required: true,
            uniqueBy: ['chain', 'resource_key'],
            uiHint: {
              widget: 'resource_selector',
              resourceCatalog: {
                chains: [
                  {
                    key: 'ethereum',
                    label: 'Ethereum',
                    resources: [
                      {
                        key: 'fet_token',
                        label: 'FET',
                        kind: 'token',
                        identifier: '0xtoken',
                        tokenIdentifier: '0xtoken',
                        tokenKey: 'fet',
                      },
                      {
                        key: 'fet_staking_1',
                        label: 'FET Staking',
                        kind: 'contract',
                        identifier: '0xstaking',
                        tokenIdentifier: '0xtoken',
                        tokenKey: 'fet',
                        parentResourceKey: 'fet_token',
                      },
                    ],
                  },
                ],
              },
            },
            item: {
              type: 'object',
              properties: [
                {
                  key: 'chain',
                  label: 'Chain',
                  description: 'Selected chain.',
                  type: 'string',
                  required: true,
                  enum: ['ethereum', 'cardano'],
                  uiHint: {
                    widget: 'select',
                    options: [
                      { value: 'ethereum', label: 'Ethereum' },
                      { value: 'cardano', label: 'Cardano' },
                    ],
                  },
                },
                {
                  key: 'resource_key',
                  label: 'Resource',
                  description: 'Resource key from the catalog.',
                  type: 'string',
                  required: true,
                  enum: ['fet_token', 'fet_staking_1'],
                  uiHint: {
                    widget: 'select',
                    dependsOn: 'chain',
                    options: [
                      { value: 'fet_token', label: 'FET', filterBy: 'ethereum' },
                      { value: 'fet_staking_1', label: 'FET Staking', filterBy: 'ethereum' },
                    ],
                  },
                },
              ],
            },
          },
        ],
        outputs: [
          {
            key: 'result',
            type: 'csv',
            csv: {
              columns: [{ key: 'wallet_address', type: 'string' }],
            },
          },
        ],
        runtime: 'typescript',
        validation: {
          rules: [
            {
              kind: 'json_chain_coverage',
              walletInputKey: 'wallets',
              selectorInputKey: 'selected_resources',
              selectorChainField: 'chain',
            },
          ],
        },
      };

      const result = validator.validate(resourceSelectorDefinition);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate combined algorithms with sub-algorithm inputs', () => {
      const combinedDefinition = {
        key: 'combined_algorithm',
        name: 'Combined Algorithm',
        kind: 'combined',
        category: 'Custom',
        summary: 'Combines multiple sub-algorithms.',
        description: 'Uses the sub-algorithm composer input.',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            label: 'Sub IDs',
            description: 'Shared SubID input.',
            type: 'json',
            required: true,
            json: {
              maxBytes: 1024,
              schema: 'sub_id_input_map',
              allowedChains: ['ethereum', 'cardano'],
            },
          },
          {
            key: 'sub_algorithms',
            label: 'Sub-Algorithms',
            description: 'Nested algorithms composed into this definition.',
            type: 'sub_algorithm',
            required: true,
            minItems: 1,
            maxItems: 5,
            sharedInputKeys: ['sub_ids'],
            uiHint: {
              widget: 'sub_algorithm_composer',
              addButtonLabel: 'Add sub-algorithm',
            },
          },
        ],
        outputs: [
          {
            key: 'result',
            type: 'json',
          },
        ],
        runtime: 'typescript',
      };

      const result = validator.validate(combinedDefinition);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Invalid Fixtures', () => {
    it('should reject invalid-key.json with invalid key format', () => {
      const fixturePath = join(__dirname, '../../../fixtures/invalid/invalid-key.json');
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const result = validator.validate(fixture);
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.some((e) => e.instancePath === '/key')).toBe(true);
    });

    it('should reject invalid-version.json with invalid version format', () => {
      const fixturePath = join(__dirname, '../../../fixtures/invalid/invalid-version.json');
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const result = validator.validate(fixture);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.instancePath === '/version')).toBe(true);
    });

    it('should reject missing-fields.json with missing required category', () => {
      const fixturePath = join(__dirname, '../../../fixtures/invalid/missing-fields.json');
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

      const result = validator.validate(fixture);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });
  });

  describe('Schema Constraints', () => {
    it('should require snake_case keys', () => {
      const invalid = {
        key: 'InvalidKey',
        name: 'Test',
        category: 'Activity',
        summary: 'Test',
        description: 'Test',
        version: '1.0.0',
        inputs: [],
        outputs: [
          {
            key: 'result',
            type: 'csv',
            csv: {
              hasHeader: true,
              delimiter: ',',
              columns: [
                { key: 'collection_id', type: 'string', description: 'User identifier' },
                { key: 'result', type: 'number', description: 'Result score' },
              ],
            },
          },
        ],
        runtime: 'typescript',
      };

      const result = validator.validate(invalid);
      expect(result.isValid).toBe(false);
    });

    it('should require semantic version format', () => {
      const invalid = {
        key: 'test_algo',
        name: 'Test',
        category: 'Activity',
        summary: 'Test',
        description: 'Test',
        version: 'v1.0',
        inputs: [],
        outputs: [
          {
            key: 'result',
            type: 'csv',
            csv: {
              hasHeader: true,
              delimiter: ',',
              columns: [
                { key: 'collection_id', type: 'string', description: 'User identifier' },
                { key: 'result', type: 'number', description: 'Result score' },
              ],
            },
          },
        ],
        runtime: 'typescript',
      };

      const result = validator.validate(invalid);
      expect(result.isValid).toBe(false);
    });

    it('should require at least one output', () => {
      const invalid = {
        key: 'test_algo',
        name: 'Test',
        category: 'Activity',
        summary: 'Test',
        description: 'Test',
        version: '1.0.0',
        inputs: [],
        outputs: [],
        runtime: 'typescript',
      };

      const result = validator.validate(invalid);
      expect(result.isValid).toBe(false);
    });

    it('should require csv metadata when type is csv', () => {
      const invalid = {
        key: 'test_algo',
        name: 'Test',
        category: 'Activity',
        summary: 'Test',
        description: 'Test',
        version: '1.0.0',
        inputs: [
          {
            key: 'data',
            type: 'csv',
          },
        ],
        outputs: [
          {
            key: 'result',
            type: 'csv',
            csv: {
              hasHeader: true,
              delimiter: ',',
              columns: [
                { key: 'collection_id', type: 'string', description: 'User identifier' },
                { key: 'result', type: 'number', description: 'Result score' },
              ],
            },
          },
        ],
        runtime: 'typescript',
      };

      const result = validator.validate(invalid);
      expect(result.isValid).toBe(false);
    });

    it('should require csv property when type is csv', () => {
      const invalid = {
        key: 'test_algo',
        name: 'Test',
        category: 'Activity',
        summary: 'Test',
        description: 'Test',
        version: '1.0.0',
        inputs: [],
        outputs: [
          {
            key: 'result',
            type: 'csv',
          },
        ],
        runtime: 'typescript',
      };

      const result = validator.validate(invalid);
      expect(result.isValid).toBe(false);
    });

    it('should accept valid categories', () => {
      const categories = ['Engagement', 'Activity'];

      for (const category of categories) {
        const valid = {
          key: 'test_algo',
          name: 'Test',
          category,
          summary: 'Test',
          description: 'Test',
          version: '1.0.0',
          inputs: [],
          outputs: [
            {
              key: 'result',
              type: 'csv',
              csv: {
                hasHeader: true,
                delimiter: ',',
                columns: [
                  { key: 'collection_id', type: 'string', description: 'User identifier' },
                  { key: 'result', type: 'number', description: 'Result score' },
                ],
              },
            },
          ],
          runtime: 'typescript',
        };

        const result = validator.validate(valid);
        expect(result.isValid).toBe(true);
      }
    });
  });

  describe('Runtime', () => {
    it('should accept valid runtime values', () => {
      const runtimes = ['typescript', 'python'];

      for (const runtime of runtimes) {
        const valid = {
          key: 'test_algo',
          name: 'Test',
          category: 'Activity',
          summary: 'Test',
          description: 'Test',
          version: '1.0.0',
          inputs: [],
          outputs: [
            {
              key: 'result',
              type: 'csv',
              csv: {
                hasHeader: true,
                delimiter: ',',
                columns: [
                  { key: 'collection_id', type: 'string', description: 'User identifier' },
                  { key: 'result', type: 'number', description: 'Result score' },
                ],
              },
            },
          ],
          runtime,
        };

        const result = validator.validate(valid);
        expect(result.isValid).toBe(true);
      }
    });

    it('should reject algorithm without runtime (required)', () => {
      const invalid = {
        key: 'test_algo',
        name: 'Test',
        category: 'Activity',
        summary: 'Test',
        description: 'Test',
        version: '1.0.0',
        inputs: [],
        outputs: [
          {
            key: 'result',
            type: 'csv',
            csv: {
              hasHeader: true,
              delimiter: ',',
              columns: [
                { key: 'collection_id', type: 'string', description: 'User identifier' },
                { key: 'result', type: 'number', description: 'Result score' },
              ],
            },
          },
        ],
      };

      const result = validator.validate(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.instancePath === '' && e.keyword === 'required')).toBe(true);
    });

    it('should reject unsupported runtime values', () => {
      const invalid = {
        key: 'test_algo',
        name: 'Test',
        category: 'Activity',
        summary: 'Test',
        description: 'Test',
        version: '1.0.0',
        inputs: [],
        outputs: [
          {
            key: 'result',
            type: 'csv',
            csv: {
              hasHeader: true,
              delimiter: ',',
              columns: [
                { key: 'collection_id', type: 'string', description: 'User identifier' },
                { key: 'result', type: 'number', description: 'Result score' },
              ],
            },
          },
        ],
        runtime: 'ruby',
      };

      const result = validator.validate(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.instancePath === '/runtime')).toBe(true);
    });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { AlgorithmDefinition } from '../../src/types/index.js';
import { buildZodSchema, validatePayload } from '../../src/validation.js';

const definition: AlgorithmDefinition = {
  key: 'engagement_score',
  name: 'Engagement Score',
  category: 'Engagement',
  description: 'Scores user engagement from uploaded data.',
  version: '1.0.0',
  inputs: [
    {
      key: 'wallets',
      label: 'Wallet Addresses JSON',
      type: 'json',
      json: {
        maxBytes: 5242880,
        schema: 'wallet_address_map',
        rootKey: 'wallets',
        allowedChains: ['ethereum', 'cardano'],
      },
    },
    {
      key: 'votes_csv',
      label: 'Votes CSV',
      type: 'csv',
      csv: {
        columns: [{ key: 'user_id', type: 'string', required: true }],
      },
    },
    {
      key: 'threshold',
      label: 'Threshold',
      type: 'number',
      min: 0,
      max: 10,
    },
    {
      key: 'min_votes',
      label: 'Minimum Votes',
      type: 'integer',
      min: 1,
    },
    {
      key: 'name',
      label: 'Display Name',
      type: 'string',
      minLength: 3,
    },
    {
      key: 'include_inactive',
      label: 'Include Inactive',
      type: 'boolean',
      required: false,
    },
  ],
  outputs: [],
  runtime: 'typescript',
};

describe('validation', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('coerces numeric strings, trims text, and accepts storage keys on the server', () => {
    const result = validatePayload(definition, {
      wallets: 'uploads/wallets.json',
      votes_csv: 'uploads/votes.csv',
      threshold: '2.5',
      min_votes: '3',
      name: '  Alice  ',
    });

    expect(result).toEqual({
      success: true,
      data: {
        wallets: 'uploads/wallets.json',
        votes_csv: 'uploads/votes.csv',
        threshold: 2.5,
        min_votes: 3,
        name: 'Alice',
      },
    });
  });

  it('returns field-level validation errors for missing and invalid values', () => {
    const result = validatePayload(definition, {
      wallets: '',
      votes_csv: '',
      threshold: '11',
      min_votes: '2.5',
      name: '  ',
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'wallets', message: 'Wallet Addresses JSON is required' }),
        expect.objectContaining({ field: 'votes_csv', message: 'Votes CSV is required' }),
        expect.objectContaining({ field: 'threshold', message: 'Threshold must be at most 10' }),
        expect.objectContaining({ field: 'min_votes', message: 'Minimum Votes must be a whole number' }),
        expect.objectContaining({ field: 'name', message: 'Display Name is required' }),
      ]),
    );
  });

  it('accepts either a File or a storage key for csv and json inputs in the browser', () => {
    (globalThis as { window?: unknown }).window = {};
    const schema = buildZodSchema(definition);
    const jsonFile = new File(
      [
        JSON.stringify({
          wallets: {
            ethereum: ['0x1234567890abcdef1234567890abcdef12345678'],
          },
        }),
      ],
      'wallets.json',
      { type: 'application/json' },
    );
    const file = new File(['user_id\n1'], 'votes.csv', { type: 'text/csv' });

    const fileResult = schema.safeParse({
      wallets: jsonFile,
      votes_csv: file,
      threshold: 1,
      min_votes: 1,
      name: 'Alice',
    });
    const keyResult = schema.safeParse({
      wallets: 'uploads/wallets.json',
      votes_csv: 'uploads/votes.csv',
      threshold: 1,
      min_votes: 1,
      name: 'Alice',
    });

    expect(fileResult.success).toBe(true);
    expect(keyResult.success).toBe(true);
  });

  it('returns a schema-level error when the definition shape is invalid', () => {
    const result = validatePayload(
      {
        ...definition,
        inputs: null,
      } as unknown as AlgorithmDefinition,
      {},
    );

    expect(result).toEqual({
      success: false,
      errors: [
        {
          field: '_schema',
          message: expect.stringContaining('Validation error:'),
        },
      ],
    });
  });

  it('builds correct zod schema when array input uses itemProperties (FormSchema format)', () => {
    const formSchema = {
      ...definition,
      inputs: [
        {
          key: 'token_configs',
          label: 'Tokens to Include',
          type: 'array',
          minItems: 1,
          required: true,
          itemProperties: [
            {
              key: 'chain',
              label: 'Chain',
              type: 'select',
              required: true,
              enum: ['ethereum'],
            },
            {
              key: 'asset_identifier',
              label: 'Token',
              type: 'select',
              required: true,
              enum: ['0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85'],
            },
          ],
        },
      ],
    } as unknown as AlgorithmDefinition;

    const valid = validatePayload(formSchema, {
      token_configs: [{ chain: 'ethereum', asset_identifier: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85' }],
    });
    expect(valid.success).toBe(true);

    const invalid = validatePayload(formSchema, {
      token_configs: [{}],
    });
    expect(invalid.success).toBe(false);
    expect(invalid.errors?.some((e) => e.field.includes('chain'))).toBe(true);
  });

  it('rejects duplicate uniqueBy combinations in array inputs', () => {
    const defWithTargetConfigs: AlgorithmDefinition = {
      ...definition,
      inputs: [
        {
          key: 'target_configs',
          label: 'Targets to Include',
          type: 'array',
          minItems: 1,
          required: true,
          uniqueBy: ['chain', 'target_identifier'],
          item: {
            type: 'object',
            properties: [
              { key: 'chain', label: 'Chain', type: 'string', required: true },
              { key: 'target_identifier', label: 'Target', type: 'string', required: true },
            ],
          },
        },
      ],
    };

    const valid = validatePayload(defWithTargetConfigs, {
      target_configs: [
        { chain: 'ethereum', target_identifier: '0xaaa' },
        { chain: 'ethereum', target_identifier: '0xbbb' },
      ],
    });
    expect(valid.success).toBe(true);

    const duplicate = validatePayload(defWithTargetConfigs, {
      target_configs: [
        { chain: 'ethereum', target_identifier: '0xaaa' },
        { chain: 'ethereum', target_identifier: '0xaaa' },
      ],
    });
    expect(duplicate.success).toBe(false);
    expect(duplicate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'target_configs',
          message: 'Targets to Include must not contain duplicate chain + target_identifier combinations',
        }),
      ]),
    );
  });

  it('validates resource selector inputs against the catalog and selected chain', () => {
    const resourceSelectorDefinition: AlgorithmDefinition = {
      ...definition,
      inputs: [
        {
          key: 'selected_resources',
          label: 'Resources to Include',
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
                {
                  key: 'cardano',
                  label: 'Cardano',
                  resources: [
                    {
                      key: 'fet_token',
                      label: 'FET',
                      kind: 'token',
                      identifier: 'asset1',
                      tokenIdentifier: 'asset1',
                      tokenKey: 'fet',
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
                type: 'string',
                required: true,
                enum: ['ethereum', 'cardano', 'cosmos'],
                uiHint: {
                  widget: 'select',
                  options: [
                    { value: 'ethereum', label: 'Ethereum' },
                    { value: 'cardano', label: 'Cardano' },
                    { value: 'cosmos', label: 'Cosmos' },
                  ],
                },
              },
              {
                key: 'resource_key',
                label: 'Resource',
                type: 'string',
                required: true,
                enum: ['fet_token', 'fet_staking_1'],
              },
            ],
          },
        },
      ],
    };

    const valid = validatePayload(resourceSelectorDefinition, {
      selected_resources: [
        {
          chain: 'ethereum',
          resource_key: 'fet_staking_1',
        },
      ],
    });
    expect(valid.success).toBe(true);

    const invalidChain = validatePayload(resourceSelectorDefinition, {
      selected_resources: [
        {
          chain: 'cosmos',
          resource_key: 'fet_token',
        },
      ],
    });
    expect(invalidChain.success).toBe(false);
    expect(invalidChain.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'selected_resources.0.chain',
          message: 'Chain must match the resource selector catalog',
        }),
      ]),
    );

    const invalidResource = validatePayload(resourceSelectorDefinition, {
      selected_resources: [
        {
          chain: 'cardano',
          resource_key: 'fet_staking_1',
        },
      ],
    });
    expect(invalidResource.success).toBe(false);
    expect(invalidResource.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'selected_resources.0.resource_key',
          message: 'Resource must match the selected chain',
        }),
      ]),
    );
  });
});

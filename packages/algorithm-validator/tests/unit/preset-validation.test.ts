import { describe, expect, it, vi } from 'vitest';
import { validateAlgorithmPreset } from '../../src/preset-validation.js';
import type { AlgorithmDefinition } from '../../src/types/index.js';

const definition: AlgorithmDefinition = {
  key: 'token_value_over_time',
  name: 'Token Value Over Time',
  category: 'Activity',
  summary: 'Tracks token holdings over time.',
  description: 'Measures long-held token value.',
  version: '1.0.0',
  inputs: [
    {
      key: 'sub_ids',
      label: 'SubID Input JSON',
      type: 'json',
      required: true,
      json: {
        maxBytes: 5242880,
        schema: 'sub_id_input_map',
        allowedChains: ['ethereum', 'cardano'],
      },
    },
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
                  identifier: '0xaaa',
                  tokenIdentifier: '0xaaa',
                  tokenKey: 'fet',
                },
                {
                  key: 'fet_staking_1',
                  label: 'FET Staking',
                  kind: 'contract',
                  identifier: '0xbbb',
                  tokenIdentifier: '0xaaa',
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
                  identifier: 'assetcardano',
                  tokenIdentifier: 'assetcardano',
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
            enum: ['ethereum', 'cardano'],
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
  outputs: [
    {
      key: 'token_value_over_time',
      label: 'Token Value Over Time',
      type: 'csv',
      csv: {
        columns: [
          {
            key: 'sub_id',
            type: 'string',
          },
        ],
      },
    },
  ],
  runtime: 'typescript',
};

const combinedDefinition: AlgorithmDefinition = {
  key: 'custom_score',
  name: 'Custom Algorithm',
  kind: 'combined',
  category: 'Custom',
  summary: 'Combines standalone algorithms.',
  description: 'Combined algorithm test definition.',
  version: '1.0.0',
  inputs: [
    {
      key: 'sub_ids',
      label: 'SubID Input JSON',
      type: 'json',
      required: true,
      json: {
        maxBytes: 5242880,
        schema: 'sub_id_input_map',
        allowedChains: ['ethereum', 'cardano'],
      },
    },
    {
      key: 'sub_algorithms',
      label: 'Sub-Algorithms',
      type: 'sub_algorithm',
      required: true,
      minItems: 1,
      sharedInputKeys: ['sub_ids'],
      uiHint: {
        widget: 'sub_algorithm_composer',
      },
    },
  ],
  outputs: [],
  runtime: 'typescript',
};

const childVotesDefinition: AlgorithmDefinition = {
  key: 'voting_engagement',
  name: 'Voting Engagement',
  kind: 'standalone',
  category: 'Engagement',
  summary: 'Validates a child CSV input.',
  description: 'Standalone child definition for combined validation tests.',
  version: '1.0.0',
  inputs: [
    {
      key: 'sub_ids',
      label: 'SubID Input JSON',
      type: 'json',
      required: true,
      json: {
        maxBytes: 5242880,
        schema: 'sub_id_input_map',
        allowedChains: ['ethereum', 'cardano'],
      },
    },
    {
      key: 'votes',
      label: 'Votes CSV',
      type: 'csv',
      csv: {
        hasHeader: true,
        delimiter: ',',
        columns: [
          {
            key: 'id',
            type: 'number',
            required: true,
          },
        ],
      },
    },
  ],
  outputs: [],
  runtime: 'typescript',
};

const childSharedOnlyDefinition: AlgorithmDefinition = {
  key: 'proposal_engagement',
  name: 'Proposal Engagement',
  kind: 'standalone',
  category: 'Engagement',
  summary: 'Uses only the shared parent input.',
  description: 'Standalone child definition for shared input tests.',
  version: '1.0.0',
  inputs: [
    {
      key: 'sub_ids',
      label: 'SubID Input JSON',
      type: 'json',
      required: true,
      json: {
        maxBytes: 5242880,
        schema: 'sub_id_input_map',
        allowedChains: ['ethereum', 'cardano'],
      },
    },
  ],
  outputs: [],
  runtime: 'typescript',
};

describe('validateAlgorithmPreset', () => {
  it('validates supported grouped resources and file-backed rules through the shared validator', async () => {
    const result = await validateAlgorithmPreset({
      definition,
      preset: {
        key: 'token_value_over_time',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'selected_resources',
            value: [
              {
                chain: 'ethereum',
                resource_key: 'fet_staking_1',
              },
            ],
          },
        ],
      },
      resolveInputContent: async ({ input, value }) => {
        if (input.key === 'sub_ids' && typeof value === 'string') {
          return JSON.stringify({
            'SubID-1': {
              userWallets: [
                {
                  address: '0x1234567890abcdef1234567890abcdef12345678',
                  chain: 'ethereum',
                },
              ],
            },
          });
        }

        return value;
      },
    });

    expect(result.success).toBe(true);
  });

  it('allows selected chains with no uploaded wallets', async () => {
    const result = await validateAlgorithmPreset({
      definition,
      preset: {
        key: 'token_value_over_time',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'selected_resources',
            value: [
              {
                chain: 'cardano',
                resource_key: 'fet_token',
              },
            ],
          },
        ],
      },
      resolveInputContent: async ({ input, value }) => {
        if (input.key === 'sub_ids' && typeof value === 'string') {
          return JSON.stringify({
            'SubID-1': {
              userWallets: [
                {
                  address: '0x1234567890abcdef1234567890abcdef12345678',
                  chain: 'ethereum',
                },
              ],
            },
            'SubID-2': {},
          });
        }

        return value;
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsupported legacy preset inputs with a recreate message', async () => {
    const result = await validateAlgorithmPreset({
      definition,
      preset: {
        key: 'token_value_over_time',
        version: '1.0.0',
        inputs: [
          {
            key: 'selected_targets',
            value: [
              {
                chain: 'ethereum',
                target_identifier: '0xaaa',
              },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'selected_targets',
          source: 'definition',
          message: expect.stringContaining('Recreate the preset'),
        }),
        expect.objectContaining({
          field: 'selected_resources',
          source: 'payload',
        }),
      ]),
    );
  });

  it('rejects old-format wallet files that still use the legacy top-level wallets key', async () => {
    const result = await validateAlgorithmPreset({
      definition,
      preset: {
        key: 'token_value_over_time',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'selected_resources',
            value: [
              {
                chain: 'ethereum',
                resource_key: 'fet_token',
              },
            ],
          },
        ],
      },
      resolveInputContent: async ({ input, value }) => {
        if (input.key === 'sub_ids' && typeof value === 'string') {
          return JSON.stringify({
            wallets: {
              ethereum: ['0x1234567890abcdef1234567890abcdef12345678'],
            },
          });
        }

        return value;
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'sub_ids',
          source: 'file',
          message: 'Legacy top-level "wallets" JSON is not supported; provide SubID keys at the root',
        }),
      ]),
    );
  });

  it('rejects resource keys that do not belong to the selected chain', async () => {
    const result = await validateAlgorithmPreset({
      definition,
      preset: {
        key: 'token_value_over_time',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'selected_resources',
            value: [
              {
                chain: 'cardano',
                resource_key: 'fet_staking_1',
              },
            ],
          },
        ],
      },
      resolveInputContent: async ({ input, value }) => {
        if (input.key === 'sub_ids' && typeof value === 'string') {
          return JSON.stringify({
            'SubID-1': {
              userWallets: [
                {
                  address: 'addr1q9exampleexampleexampleexampleexampleexample',
                  chain: 'cardano',
                },
              ],
            },
          });
        }

        return value;
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'selected_resources.0.resource_key',
          source: 'payload',
          message: 'Resource must match the selected chain',
        }),
      ]),
    );
  });

  it('resolves child definitions, injects shared parent inputs, and validates nested file-backed inputs', async () => {
    const resolveNestedDefinition = async () => childVotesDefinition;
    const resolveInputContent = async ({ value }: { value: unknown }) => {
      if (value === 'uploads/sub_ids.json') {
        return JSON.stringify({
          'SubID-1': {
            userWallets: [
              {
                address: '0x1234567890abcdef1234567890abcdef12345678',
                chain: 'ethereum',
              },
            ],
          },
        });
      }

      if (value === 'uploads/votes.csv') {
        return 'id\n1\n';
      }

      return value;
    };

    const result = await validateAlgorithmPreset({
      definition: combinedDefinition,
      preset: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'voting_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [
                  {
                    key: 'votes',
                    value: 'uploads/votes.csv',
                  },
                ],
              },
            ],
          },
        ],
      },
      resolveNestedDefinition,
      resolveInputContent,
    });

    expect(result.success).toBe(true);
  });

  it('injects shared parent inputs into children that only rely on inherited files', async () => {
    const resolveNestedDefinition = vi.fn(async () => childSharedOnlyDefinition);
    const resolveInputContent = vi.fn(async ({ value }: { value: unknown }) => {
      if (value === 'uploads/sub_ids.json') {
        return JSON.stringify({
          'SubID-1': {
            userWallets: [
              {
                address: '0x1234567890abcdef1234567890abcdef12345678',
                chain: 'ethereum',
              },
            ],
          },
        });
      }

      return value;
    });

    const result = await validateAlgorithmPreset({
      definition: combinedDefinition,
      preset: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'proposal_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [],
              },
            ],
          },
        ],
      },
      resolveNestedDefinition,
      resolveInputContent,
    });

    expect(result.success).toBe(true);
    expect(resolveNestedDefinition).toHaveBeenCalledWith({
      algorithmKey: 'proposal_engagement',
      algorithmVersion: '1.0.0',
      childIndex: 0,
      parentDefinition: combinedDefinition,
      parentInput: expect.objectContaining({
        key: 'sub_algorithms',
      }),
    });
  });

  it('prefixes nested child validation errors under the parent sub_algorithm input', async () => {
    const result = await validateAlgorithmPreset({
      definition: combinedDefinition,
      preset: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'voting_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [],
              },
            ],
          },
        ],
      },
      resolveNestedDefinition: async () => childVotesDefinition,
      resolveInputContent: async ({ value }) => {
        if (value === 'uploads/sub_ids.json') {
          return JSON.stringify({
            'SubID-1': {
              userWallets: [
                {
                  address: '0x1234567890abcdef1234567890abcdef12345678',
                  chain: 'ethereum',
                },
              ],
            },
          });
        }

        return value;
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'sub_algorithms.0.inputs.votes',
          source: 'payload',
        }),
      ]),
    );
  });

  it('rejects sub-algorithm entries with non-positive weights', async () => {
    const result = await validateAlgorithmPreset({
      definition: combinedDefinition,
      preset: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'voting_engagement',
                algorithm_version: '1.0.0',
                weight: 0,
                inputs: [],
              },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'sub_algorithms.0.weight',
          source: 'payload',
          message: expect.stringContaining('greater than 0'),
        }),
      ]),
    );
  });

  it('rejects child entries that duplicate shared parent inputs', async () => {
    const result = await validateAlgorithmPreset({
      definition: combinedDefinition,
      preset: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'proposal_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [
                  {
                    key: 'sub_ids',
                    value: 'uploads/child-sub-ids.json',
                  },
                ],
              },
            ],
          },
        ],
      },
      resolveNestedDefinition: async () => childSharedOnlyDefinition,
      resolveInputContent: async ({ value }) => {
        if (typeof value === 'string') {
          return JSON.stringify({});
        }

        return value;
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'sub_algorithms.0.inputs.sub_ids',
          source: 'definition',
          message: expect.stringContaining('inherited from the parent algorithm'),
        }),
      ]),
    );
  });

  it('rejects combined algorithms as nested sub-algorithm definitions', async () => {
    const result = await validateAlgorithmPreset({
      definition: combinedDefinition,
      preset: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          {
            key: 'sub_ids',
            value: 'uploads/sub_ids.json',
          },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'nested_custom',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [],
              },
            ],
          },
        ],
      },
      resolveNestedDefinition: async () => ({
        ...combinedDefinition,
        key: 'nested_custom',
      }),
      resolveInputContent: async ({ value }) => {
        if (typeof value === 'string') {
          return JSON.stringify({});
        }

        return value;
      },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'sub_algorithms.0.algorithm_key',
          source: 'definition',
          message: expect.stringContaining('must not be a combined algorithm'),
        }),
      ]),
    );
  });
});

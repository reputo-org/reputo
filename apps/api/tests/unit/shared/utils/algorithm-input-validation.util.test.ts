import { validateAlgorithmPreset } from '@reputo/algorithm-validator';
import { getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import type { StorageMetadata } from '@reputo/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAlgorithmInputs } from '../../../../src/shared/utils/algorithm-input-validation.util';

vi.mock('@reputo/algorithm-validator', async () => {
  const actual = await vi.importActual('@reputo/algorithm-validator');
  return {
    ...actual,
    validateAlgorithmPreset: vi.fn(),
  };
});

vi.mock('@reputo/reputation-algorithms', async () => {
  const actual = await vi.importActual('@reputo/reputation-algorithms');
  return {
    ...actual,
    getAlgorithmDefinition: vi.fn(),
  };
});

describe('validateAlgorithmInputs adapter', () => {
  const storageMetadata: StorageMetadata = {
    filename: 'votes.csv',
    ext: 'csv',
    size: 128,
    contentType: 'text/csv',
    timestamp: 1,
  };

  const customAlgorithmDefinition = {
    key: 'custom_algorithm',
    name: 'Custom Algorithm',
    kind: 'combined',
    category: 'Custom',
    summary: 'Combines child algorithms.',
    description: 'Combines child algorithms.',
    version: '1.0.0',
    inputs: [
      {
        key: 'sub_ids',
        label: 'Sub IDs',
        type: 'json',
        required: true,
        json: {
          schema: 'sub_id_input_map',
        },
      },
      {
        key: 'sub_algorithms',
        label: 'Sub Algorithms',
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

  const childDefinition = {
    key: 'voting_engagement',
    name: 'Voting Engagement',
    kind: 'standalone',
    category: 'Engagement',
    summary: 'Scores votes.',
    description: 'Scores votes.',
    version: '1.0.0',
    inputs: [
      {
        key: 'sub_ids',
        label: 'Sub IDs',
        type: 'json',
        required: true,
        json: {
          schema: 'sub_id_input_map',
        },
      },
      {
        key: 'votes',
        label: 'Votes',
        type: 'csv',
        required: true,
        csv: {
          hasHeader: true,
          delimiter: ',',
          columns: [{ key: 'id', type: 'number', required: true }],
        },
      },
    ],
    outputs: [],
    runtime: 'typescript',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAlgorithmPreset).mockResolvedValue({
      success: true,
      data: {
        preset: {},
        payload: {},
      },
    });
    vi.mocked(getAlgorithmDefinition).mockReturnValue(JSON.stringify(childDefinition));
  });

  it('calls the shared validator package and exposes nested/file resolvers', async () => {
    const storageService = {
      getObjectMetadata: vi.fn().mockResolvedValue(storageMetadata),
      getObject: vi.fn().mockResolvedValue(Buffer.from('id\n1\n')),
    };

    await validateAlgorithmInputs({
      definition: customAlgorithmDefinition as never,
      inputs: [
        { key: 'sub_ids', value: 'uploads/sub_ids.json' },
        {
          key: 'sub_algorithms',
          value: [
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              weight: 1,
              inputs: [{ key: 'votes', value: 'uploads/votes.csv' }],
            },
          ],
        },
      ],
      storageService: storageService as never,
      storageMaxSizeBytes: 1024,
      storageContentTypeAllowlist: 'text/csv,application/json',
    });

    expect(validateAlgorithmPreset).toHaveBeenCalledOnce();

    const call = vi.mocked(validateAlgorithmPreset).mock.calls[0]?.[0];
    expect(call.definition).toEqual(customAlgorithmDefinition);
    expect(call.preset).toEqual({
      key: 'custom_algorithm',
      version: '1.0.0',
      inputs: [
        { key: 'sub_ids', value: 'uploads/sub_ids.json' },
        {
          key: 'sub_algorithms',
          value: [
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              weight: 1,
              inputs: [{ key: 'votes', value: 'uploads/votes.csv' }],
            },
          ],
        },
      ],
    });

    await expect(
      call.resolveNestedDefinition({
        algorithmKey: 'voting_engagement',
        algorithmVersion: '1.0.0',
      }),
    ).resolves.toEqual(childDefinition);

    await expect(
      call.resolveInputContent({
        input: childDefinition.inputs[1],
        value: 'uploads/votes.csv',
      }),
    ).resolves.toEqual(Buffer.from('id\n1\n'));

    expect(getAlgorithmDefinition).toHaveBeenCalledWith({
      key: 'voting_engagement',
      version: '1.0.0',
    });
    expect(storageService.getObjectMetadata).toHaveBeenCalledWith('uploads/votes.csv');
    expect(storageService.getObject).toHaveBeenCalledWith('uploads/votes.csv');
  });
});

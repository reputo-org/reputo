import { describe, expect, it } from 'vitest';

import { algorithmPythonTaskQueue, algorithmTypescriptTaskQueue } from '../../../src/shared/constants/index.js';
import {
  buildCombinedChildAlgorithmPresets,
  getAlgorithmTaskQueueFromRuntime,
} from '../../../src/shared/utils/orchestrator-input.utils.js';

describe('getAlgorithmTaskQueueFromRuntime', () => {
  it('returns typescript queue when runtime is typescript', () => {
    expect(getAlgorithmTaskQueueFromRuntime('typescript')).toBe(algorithmTypescriptTaskQueue);
  });

  it('returns python queue when runtime is python', () => {
    expect(getAlgorithmTaskQueueFromRuntime('python')).toBe(algorithmPythonTaskQueue);
  });

  it('throws for unsupported runtime', () => {
    expect(() => getAlgorithmTaskQueueFromRuntime('go')).toThrow('Unsupported algorithm runtime: go');
  });
});

describe('buildCombinedChildAlgorithmPresets', () => {
  it('injects shared parent inputs while keeping child-specific inputs', () => {
    expect(
      buildCombinedChildAlgorithmPresets(
        {
          inputs: [
            { key: 'dids', value: 'uploads/dids.json' },
            {
              key: 'selected_resources',
              value: [{ chain: 'ethereum', resource_key: 'fet_token' }],
            },
            {
              key: 'sub_algorithms',
              value: [
                {
                  algorithm_key: 'token_value_over_time',
                  algorithm_version: '1.0.0',
                  weight: 1,
                  inputs: [
                    { key: 'lookback_window_days', value: 90 },
                    { key: 'dids', value: 'uploads/child-sub-ids.json' },
                  ],
                },
              ],
            },
          ],
        },
        {
          inputs: [
            {
              key: 'sub_algorithms',
              type: 'sub_algorithm',
              sharedInputKeys: ['dids', 'selected_resources'],
            },
          ],
        },
      ),
    ).toEqual([
      {
        key: 'token_value_over_time',
        version: '1.0.0',
        inputs: [
          { key: 'lookback_window_days', value: 90 },
          { key: 'dids', value: 'uploads/dids.json' },
          {
            key: 'selected_resources',
            value: [{ chain: 'ethereum', resource_key: 'fet_token' }],
          },
        ],
      },
    ]);
  });
});

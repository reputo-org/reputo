import { describe, expect, it } from 'vitest';

import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE } from '../../src/index.js';

describe('@reputo/contracts temporal task-queue constants', () => {
  it('exposes the API snapshot activities task queue', () => {
    expect(API_SNAPSHOT_ACTIVITIES_TASK_QUEUE).toBe('api-snapshot-activities');
  });
});

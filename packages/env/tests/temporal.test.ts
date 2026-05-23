import { describe, expect, it } from 'vitest';
import { taskQueueSchema, temporalEnvSchema } from '../src/temporal.js';

describe('temporalEnvSchema', () => {
  it('parses with defaults', () => {
    expect(temporalEnvSchema.parse({ TEMPORAL_ADDRESS: 'temporal:7233' })).toEqual({
      TEMPORAL_ADDRESS: 'temporal:7233',
      TEMPORAL_NAMESPACE: 'default',
    });
  });

  it('overrides namespace when provided', () => {
    expect(
      temporalEnvSchema.parse({
        TEMPORAL_ADDRESS: 'temporal:7233',
        TEMPORAL_NAMESPACE: 'staging',
      }),
    ).toEqual({ TEMPORAL_ADDRESS: 'temporal:7233', TEMPORAL_NAMESPACE: 'staging' });
  });

  it('requires TEMPORAL_ADDRESS', () => {
    expect(() => temporalEnvSchema.parse({})).toThrow();
  });
});

describe('taskQueueSchema', () => {
  it('builds a single-field schema with a default', () => {
    const schema = taskQueueSchema('TEMPORAL_ORCHESTRATOR_TASK_QUEUE', 'workflows');
    expect(schema.parse({})).toEqual({ TEMPORAL_ORCHESTRATOR_TASK_QUEUE: 'workflows' });
  });

  it('respects an explicit value over the default', () => {
    const schema = taskQueueSchema('TEMPORAL_ORCHESTRATOR_TASK_QUEUE', 'workflows');
    expect(schema.parse({ TEMPORAL_ORCHESTRATOR_TASK_QUEUE: 'custom-queue' })).toEqual({
      TEMPORAL_ORCHESTRATOR_TASK_QUEUE: 'custom-queue',
    });
  });

  it('merges cleanly into temporalEnvSchema', () => {
    const merged = temporalEnvSchema.extend(
      taskQueueSchema('TEMPORAL_ALGORITHM_TYPESCRIPT_TASK_QUEUE', 'algorithm-typescript').shape,
    );
    expect(merged.parse({ TEMPORAL_ADDRESS: 'temporal:7233' })).toEqual({
      TEMPORAL_ADDRESS: 'temporal:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_ALGORITHM_TYPESCRIPT_TASK_QUEUE: 'algorithm-typescript',
    });
  });
});

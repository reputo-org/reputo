import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE } from '@reputo/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(),
  workflowInfo: vi.fn(),
  isCancellation: vi.fn(),
  CancellationScope: {
    nonCancellable: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  },
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OrchestratorWorkflow module boundaries', () => {
  it('routes snapshot activities to the API task queue at module import time', async () => {
    vi.resetModules();
    const temporalWorkflow = await import('@temporalio/workflow');
    const proxyActivities = vi.mocked(temporalWorkflow.proxyActivities);
    const recordedOptions: Array<Record<string, unknown>> = [];

    proxyActivities.mockImplementation((opts) => {
      recordedOptions.push(opts as Record<string, unknown>);
      return {
        getSnapshot: vi.fn(),
        updateSnapshot: vi.fn(),
        getAlgorithmDefinition: vi.fn(),
      } as never;
    });

    vi.doMock('@reputo/database', () => {
      throw new Error('Workflow module must not import @reputo/database at runtime');
    });

    await expect(import('../../../src/workflows/orchestrator.workflow.js')).resolves.toBeDefined();
    expect(recordedOptions[0]).toMatchObject({ taskQueue: API_SNAPSHOT_ACTIVITIES_TASK_QUEUE });
  });
});

import { z } from 'zod';

/**
 * Shared Temporal connection env shape.
 *
 * Task-queue env vars are app-specific (each worker host owns its own set),
 * so the queue schema is built with {@link taskQueueSchema} at the call site.
 */
export const temporalEnvSchema = z.object({
  TEMPORAL_ADDRESS: z.string().min(1).describe('Temporal server address (host:port)'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default').describe('Temporal namespace'),
});

export type TemporalEnv = z.infer<typeof temporalEnvSchema>;

/**
 * Build a one-field schema for a single Temporal task-queue env var.
 *
 * Apps `.merge()` the result into their own schema so each worker host can
 * own its queues without restating the same Zod boilerplate.
 *
 * @param envVarName - The env var name (e.g. `TEMPORAL_ORCHESTRATOR_TASK_QUEUE`).
 * @param defaultValue - Default task-queue name (typically from `@reputo/contracts`).
 *
 * @example
 * const schema = temporalEnvSchema.merge(
 *   taskQueueSchema('TEMPORAL_ORCHESTRATOR_TASK_QUEUE', 'workflows'),
 * );
 */
export function taskQueueSchema<Name extends string>(envVarName: Name, defaultValue: string) {
  return z.object({
    [envVarName]: z.string().min(1).default(defaultValue).describe(`Temporal task queue: ${envVarName}`),
  } as Record<Name, z.ZodDefault<z.ZodString>>);
}

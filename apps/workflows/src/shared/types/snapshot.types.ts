/**
 * Types for snapshot workflow operations.
 */

/**
 * Input type for the orchestrator workflow.
 */
export interface OrchestratorWorkflowInput {
  /** UUID v7 string identifying the snapshot to execute */
  snapshotId: string;
}

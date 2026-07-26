import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Raised when a snapshot row was created but its Temporal workflow could not
 * be started. The row is marked `failed` before this is thrown, so the client
 * sees an honest outcome instead of a snapshot that never runs.
 */
export class SnapshotWorkflowStartException extends ServiceUnavailableException {
  constructor() {
    super('Snapshot workflow could not be started; the snapshot has been marked as failed');
  }
}

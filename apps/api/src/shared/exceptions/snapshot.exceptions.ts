import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Raised when a snapshot row was created but its Temporal workflow could not
 * be started. The row is marked `failed` before this is thrown, so the client
 * sees an honest outcome instead of a snapshot that never runs.
 */
export class SnapshotWorkflowStartException extends ServiceUnavailableException {
  constructor() {
    super('The snapshot could not be started. Its status was set to Failed.');
  }
}

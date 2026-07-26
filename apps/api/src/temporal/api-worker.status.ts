import { Injectable } from '@nestjs/common';

export type ApiWorkerState = 'up' | 'down' | 'disabled';

/**
 * Shared holder for the API activity worker's run state. Lives in
 * `TemporalModule` so the health endpoint can read it without importing
 * `ApiWorkerModule` (which would create a module cycle through
 * `SnapshotModule`).
 */
@Injectable()
export class ApiWorkerStatus {
  private state: ApiWorkerState = 'down';

  set(state: ApiWorkerState): void {
    this.state = state;
  }

  get(): ApiWorkerState {
    return this.state;
  }
}

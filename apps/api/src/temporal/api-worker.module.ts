import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { ApiWorkerBootstrap } from './api-worker.bootstrap';

/**
 * Wires the API-side Temporal activity worker. Kept separate from
 * `TemporalModule` to avoid a circular import: `SnapshotModule` depends on
 * `TemporalService` (for starting workflows), and the worker bootstrap depends
 * on `SnapshotService` (to serve activity calls). Splitting the worker into
 * its own module keeps the dependency graph one-way.
 */
@Module({
  imports: [ConfigModule, SnapshotModule],
  providers: [ApiWorkerBootstrap],
})
export class ApiWorkerModule {}

import { resolve } from 'node:path';
import { createVitestConfig } from '../../vitest.base';

/**
 * End-to-end suite for the reputation algorithms.
 *
 * Each test drives a real `compute<Algo>(snapshot, storage)` against real data
 * (an in-memory Storage fake, a real seeded SQLite portal DB, or — for
 * token_value_over_time — a Postgres testcontainer). Only the runtime boundary
 * (`@temporalio/activity` Context and `config`) is mocked; the loaders, pipeline,
 * serialization and storage round-trip all run for real.
 *
 * Runs serially (singleFork) because the Postgres-backed suite shares one
 * container and the suites pin the system clock with fake timers.
 */
export default createVitestConfig({
  name: '@reputo/workflows-e2e',
  include: ['tests/e2e/**/*.test.ts'],
  testTimeout: 60_000,
  hookTimeout: 180_000,
  isolate: false,
  fileParallelism: false,
  poolOptions: { forks: { singleFork: true } },
  resolve: {
    alias: {
      '@reputo/reputation-algorithms': resolve(__dirname, '../../packages/reputation-algorithms/src/index.ts'),
    },
  },
});

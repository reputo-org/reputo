import { TEST_BUCKET } from './in-memory-storage.js';

/**
 * Stand-in for the workers' env-backed `config` (`src/config/index.js`). The real
 * module validates `process.env` with Zod at import time and would throw in the
 * test runner; this provides exactly the fields the compute path and the shared
 * `logger` read.
 *
 * `nodeEnv: 'production'` keeps `logger.ts` from attaching the `pino-pretty`
 * transport (no worker thread in tests). `onchainData.uri` is a getter so the
 * token_value_over_time suite can point it at its testcontainer URL after the
 * container starts.
 *
 * Use from a test with:
 *   vi.mock('../../../src/config/index.js', async () => ({
 *     default: (await import('../utils/config-mock.js')).testConfig,
 *   }));
 */
export const testConfig = {
  storage: { bucket: TEST_BUCKET },
  logger: { level: 'silent' },
  app: { nodeEnv: 'production' },
  get onchainData() {
    return { uri: process.env.ONCHAIN_DATABASE_URL ?? '' };
  },
};

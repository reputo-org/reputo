import { generateKeyPairSync } from 'node:crypto';
import { TEST_BUCKET } from './in-memory-storage.js';

/** Generated on first read: only the GitHub suites need a signable App key. */
let githubPrivateKey: string | undefined;
const TEST_GITHUB_APP_PRIVATE_KEY = (): string => {
  githubPrivateKey ??= generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
  return githubPrivateKey;
};

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
  community: {
    discordBotToken: 'test-discord-bot-token',
    githubAppId: '1234',
    get githubAppPrivateKey() {
      return TEST_GITHUB_APP_PRIVATE_KEY();
    },
    requestTimeoutMs: 1_000,
    retryMaxAttempts: 2,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
  },
  deepId: {
    identityBaseUrl: 'https://identity.test',
    appBaseUrl: 'https://app.test',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    scopes: 'api wallets post_scores github discord mattermost',
    requestTimeoutMs: 1_000,
    concurrency: 2,
    usersPageSize: 100,
    retryMaxAttempts: 2,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
  },
  get onchainData() {
    return { uri: process.env.ONCHAIN_DATABASE_URL ?? '' };
  },
};

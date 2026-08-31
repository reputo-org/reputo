import { generateKeyPairSync } from 'node:crypto';
import type { GitHubAdapterConfig, GitHubClientConfig } from '../../src/github/types.js';
import { TEST_HTTP_CONFIG } from './mock-helpers.js';

/** A throwaway App key pair — the suites sign with the private half and verify with the public one. */
export const TEST_APP_KEYS = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export const TEST_GITHUB_APP = {
  ...TEST_HTTP_CONFIG,
  appId: '1234',
  privateKey: TEST_APP_KEYS.privateKey,
};

export const TEST_GITHUB_CLIENT_CONFIG: GitHubClientConfig = {
  ...TEST_GITHUB_APP,
  slug: 'reputo-community',
  callbackUrl: 'https://reputo.test/api/v1/community/connections/github/callback',
};

export const TEST_GITHUB_ADAPTER_CONFIG: GitHubAdapterConfig = {
  ...TEST_GITHUB_APP,
  installationId: '55',
};

export const INSTALLATION_TOKEN_BODY = {
  token: 'ghs_installation_token',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
};

/** GitHub's budget headers, as the installation responses carry them. */
export const rateLimitHeaders = (remaining: number, limit = 12_500, resetInSeconds = 3_600) => ({
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + resetInSeconds),
});

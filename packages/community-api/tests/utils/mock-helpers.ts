import { vi } from 'vitest';
import type { DiscordClientConfig } from '../../src/discord/types.js';
import type { CommunityHttpConfig } from '../../src/shared/types.js';

export const TEST_HTTP_CONFIG: CommunityHttpConfig = {
  requestTimeoutMs: 1000,
  retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
};

export const TEST_DISCORD_CONFIG: DiscordClientConfig = {
  ...TEST_HTTP_CONFIG,
  clientId: 'discord-client-id',
  clientSecret: 'discord-client-secret',
  botToken: 'discord-bot-token',
  callbackUrl: 'https://reputo.test/api/v1/community/connections/discord/callback',
};

/** A fake undici `request` result with a `body.text()` reader. */
export function mockUndiciResponse(statusCode: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    statusCode,
    headers,
    body: { text: () => Promise.resolve(text) },
  };
}

/** Silent logger stub for transport tests. */
export function createStubLogger() {
  return { debug: vi.fn(), warn: vi.fn() };
}

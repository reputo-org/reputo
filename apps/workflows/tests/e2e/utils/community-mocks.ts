import { type Mock, vi } from 'vitest';

/**
 * The runtime-boundary doubles the community e2e suites share.
 *
 * The suite runs unisolated in a single fork, so the module registry is shared:
 * a second file installing its own spies would leave the modules loaded by the
 * first file calling the originals. Every community suite routes through these
 * instances instead and resets them in `beforeEach`, since the files run one
 * after another.
 */
function singleton<T>(key: string, create: () => T): T {
  const globals = globalThis as Record<string, unknown>;
  globals[key] ??= create();
  return globals[key] as T;
}

/**
 * Shared `undici.request` spy. Use it as:
 *   vi.mock('undici', async () => ({
 *     request: (await import('../utils/community-mocks.js')).sharedUndiciRequestMock(),
 *   }));
 */
export const sharedUndiciRequestMock = (): Mock => singleton('__reputoUndiciRequest', () => vi.fn());

/** Heartbeats the faked Temporal activity Context recorded, and the details a retry resumes from. */
export interface CommunityActivityHarness {
  heartbeats: unknown[];
  heartbeatDetails: unknown;
}

export const communityActivityHarness = (): CommunityActivityHarness =>
  singleton('__reputoCommunityActivity', () => ({ heartbeats: [], heartbeatDetails: undefined }));

/** The consented-user page the faked DeepID client yields to the cohort step. */
export interface DeepIdUsersHarness {
  users: Record<string, unknown>;
}

export const deepIdUsersHarness = (): DeepIdUsersHarness => singleton('__reputoDeepIdUsers', () => ({ users: {} }));

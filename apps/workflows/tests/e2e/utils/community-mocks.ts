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

/** Shared `undici.request` spy, installed through `sharedUndiciModuleMock`. */
export const sharedUndiciRequestMock = (): Mock => singleton('__reputoUndiciRequest', () => vi.fn());

/**
 * The whole `undici` module double. Every community suite installs the same
 * one — the first file to register it wins for the shared registry, so they
 * must not differ:
 *   vi.mock('undici', async () => (await import('../utils/community-mocks.js')).sharedUndiciModuleMock());
 *
 * `Agent` stands in for the pinned dispatcher the Mattermost safe outbound path
 * builds. The spied `request` ignores the dispatcher it is handed, so the stub
 * only has to be constructible and closable.
 */
export function sharedUndiciModuleMock() {
  return {
    request: sharedUndiciRequestMock(),
    Agent: class {
      async close(): Promise<void> {}
    },
  };
}

/** Stand-in for `@temporalio/activity`'s ApplicationFailure in the module mocks. */
export class MockApplicationFailure extends Error {
  type?: string;
  nonRetryable?: boolean;

  static create({
    message,
    type,
    nonRetryable,
  }: {
    message: string;
    type?: string;
    nonRetryable?: boolean;
  }): MockApplicationFailure {
    const failure = new MockApplicationFailure(message);
    failure.type = type;
    failure.nonRetryable = nonRetryable;
    return failure;
  }
}

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

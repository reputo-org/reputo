import { CommunityContractError, CommunityHttpError, CommunityPermissionError } from '../shared/errors.js';
import type { CommunityHttpObserver, CommunityLogger } from '../shared/http.js';
import type { CommunityAdapter } from '../shared/records.js';
import type { CommunityProbeResult, CommunityResource } from '../shared/types.js';
import { createGitHubApi, type GitHubApi } from './auth.js';
import { createGitHubRecordIterator } from './fetch.js';
import { hasRequiredIssueFields, toMatchedAccountId, toRepositoryResources } from './transform.js';
import type {
  GitHubAdapterConfig,
  GitHubRateLimit,
  GitHubRawIssue,
  GitHubRawRepositoriesResponse,
  GitHubRawUser,
} from './types.js';

export interface GitHubAdapter extends CommunityAdapter {
  /** Latest installation rate-limit snapshot the crawl observed, for its fetch stats. */
  rateLimit(): GitHubRateLimit | undefined;
}

/** Repositories per listing page. 100 is GitHub's maximum. */
const REPOSITORIES_PAGE_LIMIT = 100;

/** Repositories the probe will try before concluding that nothing is readable. */
const PROBE_REPOSITORY_LIMIT = 10;

/** Every repository the installation can read, across all listing pages. */
export async function listInstallationRepositories(
  api: GitHubApi,
  installationId: string,
): Promise<CommunityResource[]> {
  const resources: CommunityResource[] = [];
  for (let page = 1; ; page++) {
    const response = await api.installationRequest<GitHubRawRepositoriesResponse>(
      installationId,
      'GET',
      `/installation/repositories?per_page=${REPOSITORIES_PAGE_LIMIT}&page=${page}`,
    );
    const listed = toRepositoryResources(response?.repositories);
    resources.push(...listed);
    if (listed.length < REPOSITORIES_PAGE_LIMIT) {
      return resources.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
}

/**
 * Lists the installation's repositories and reads one issues page, proving both
 * the App's permissions and that the fields the crawl depends on arrive.
 */
export async function probeInstallation(api: GitHubApi, installationId: string): Promise<CommunityProbeResult> {
  const resources = await listInstallationRepositories(api, installationId);

  for (const resource of resources.slice(0, PROBE_REPOSITORY_LIMIT)) {
    try {
      const issues = await api.installationRequest<GitHubRawIssue[]>(
        installationId,
        'GET',
        `/repos/${resource.name}/issues?per_page=1&state=all`,
      );
      const page = Array.isArray(issues) ? issues : [];

      if (!hasRequiredIssueFields(page)) {
        throw new CommunityContractError(
          'GitHub returned issues without an id or creation time; the fetch cannot score these repositories.',
        );
      }

      return { resourceCount: resources.length, sampledResourceId: resource.id, sampledRecordCount: page.length };
    } catch (error) {
      // A repository with issues disabled or read access revoked is normal;
      // only an installation with no readable repository at all fails a probe.
      const skippable =
        error instanceof CommunityPermissionError ||
        (error instanceof CommunityHttpError && (error.statusCode === 404 || error.statusCode === 410));
      if (!skippable) throw error;
    }
  }

  throw new CommunityPermissionError(
    resources.length === 0
      ? 'The GitHub App installation grants access to no repositories.'
      : 'The GitHub App cannot read issues in any repository of this installation.',
    403,
  );
}

/**
 * The GitHub implementation of the community platform adapter — the read side
 * only. `iterateRecords` carries no community id, so the installation is bound
 * at construction: one adapter per snapshot fetch.
 */
export function createGitHubAdapter(
  config: GitHubAdapterConfig,
  logger: CommunityLogger,
  observer?: CommunityHttpObserver,
): GitHubAdapter {
  const api = createGitHubApi(config, logger, observer);
  const repositoriesByInstallation = new Map<string, Promise<CommunityResource[]>>();

  // One listing serves every selected repository of the run and resolves the
  // stored numeric ids to the `owner/name` the crawl builds its paths from.
  const listRepositories = (installationId: string): Promise<CommunityResource[]> => {
    let pending = repositoriesByInstallation.get(installationId);
    if (!pending) {
      pending = listInstallationRepositories(api, installationId);
      repositoriesByInstallation.set(installationId, pending);
      pending.catch(() => repositoriesByInstallation.delete(installationId));
    }
    return pending;
  };

  return {
    platform: 'github',

    listResources: (installationId) => listRepositories(installationId),

    probe: (installationId) => probeInstallation(api, installationId),

    iterateRecords: createGitHubRecordIterator({
      api,
      installationId: config.installationId,
      logger,
      resolveRepository: async (resourceId) =>
        (await listRepositories(config.installationId)).find((resource) => resource.id === resourceId)?.name,
    }),

    /**
     * Logins are unique, so the lookup is exact by construction; the response is
     * still checked against the requested login, and a renamed or deleted
     * account resolves to null rather than a guess.
     */
    async searchMemberId(installationId, login) {
      try {
        const user = await api.installationRequest<GitHubRawUser>(
          installationId,
          'GET',
          `/users/${encodeURIComponent(login)}`,
        );
        return toMatchedAccountId(user, login);
      } catch (error) {
        if (error instanceof CommunityHttpError && error.statusCode === 404) {
          return null;
        }
        throw error;
      }
    },

    rateLimit: api.rateLimit,
  };
}

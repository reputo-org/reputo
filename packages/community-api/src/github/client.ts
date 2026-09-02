import { CommunityAuthError, CommunityHttpError } from '../shared/errors.js';
import type { CommunityLogger } from '../shared/http.js';
import type { CommunityProbeResult, CommunityResource } from '../shared/types.js';
import { listInstallationRepositories, probeInstallation } from './adapter.js';
import { createGitHubApi } from './auth.js';
import { buildGitHubInstallUrl, toInstallation } from './transform.js';
import type { GitHubClientConfig, GitHubInstallation, GitHubRawInstallation } from './types.js';

export interface GitHubClient {
  /**
   * App-install URL; `state` is minted and verified by the caller. GitHub
   * redirects to the App's configured setup URL, so a reconnect reuses the same
   * link and the admin picks the account again.
   */
  buildInstallUrl(state: string): string;
  /** Confirms a callback's installation id with the app JWT and returns the account it belongs to. */
  confirmInstallation(installationId: string): Promise<GitHubInstallation>;
  /** Repositories the installation can read. */
  listResources(installationId: string): Promise<CommunityResource[]>;
  /** Lists repositories and reads one issues page to verify the granted permissions. */
  probe(installationId: string): Promise<CommunityProbeResult>;
  /** Uninstalls the App. Idempotent: deleting an installation that is already gone succeeds. */
  deleteInstallation(installationId: string): Promise<void>;
}

export function createGitHubClient(config: GitHubClientConfig, logger: CommunityLogger): GitHubClient {
  const api = createGitHubApi(config, logger);

  return {
    buildInstallUrl(state) {
      return buildGitHubInstallUrl({ slug: config.slug, state });
    },

    async confirmInstallation(installationId) {
      try {
        const installation = await api.appRequest<GitHubRawInstallation>(
          'GET',
          `/app/installations/${encodeURIComponent(installationId)}`,
        );
        return toInstallation(installation);
      } catch (error) {
        // A forged or replayed callback names an installation this App does not
        // own; GitHub answers that with a 404 rather than a permission error.
        if (error instanceof CommunityHttpError && error.statusCode === 404) {
          throw new CommunityAuthError('GitHub does not report this installation for the Reputo App.', 404);
        }
        throw error;
      }
    },

    listResources(installationId) {
      return listInstallationRepositories(api, installationId);
    },

    probe(installationId) {
      return probeInstallation(api, installationId, logger);
    },

    async deleteInstallation(installationId) {
      try {
        await api.appRequest('DELETE', `/app/installations/${encodeURIComponent(installationId)}`);
      } catch (error) {
        // The App was already uninstalled, so the installation is in the state
        // we wanted.
        if (!(error instanceof CommunityHttpError && error.statusCode === 404)) {
          throw error;
        }
      }
    },
  };
}

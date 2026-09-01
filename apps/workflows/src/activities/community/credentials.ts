import {
  type CommunityCredentialKeyring,
  type MattermostTeamTarget,
  openCommunityCredential,
  parseMattermostExternalId,
} from '@reputo/community-api';
import { Pool } from 'pg';

/**
 * Worker-side access to sealed community credentials. Temporal persists
 * activity inputs and results into workflow history, so a token must never
 * travel through one — instead the worker re-reads the ciphertext from the
 * application database (over a read-only role) and unseals it in the same
 * stack frame as the outbound call that needs it.
 */
export interface CommunityCredentialsReaderOptions {
  /** Read-only connection URL of the application database. */
  databaseUrl: string;
  keyring: CommunityCredentialKeyring;
}

export interface CommunityCredentialsReader {
  /** Server, team, and unsealed token for one Mattermost connection. */
  readMattermostTarget(externalId: string): Promise<MattermostTeamTarget>;
  close(): Promise<void>;
}

interface CredentialsQueryable {
  query(text: string, values: unknown[]): Promise<{ rows: Array<{ credentials_ciphertext: string | null }> }>;
  end(): Promise<void>;
}

export function createCommunityCredentialsReader(
  options: CommunityCredentialsReaderOptions,
  pool: CredentialsQueryable = new Pool({ connectionString: options.databaseUrl, max: 1 }),
): CommunityCredentialsReader {
  return {
    async readMattermostTarget(externalId) {
      const result = await pool.query(
        'SELECT credentials_ciphertext FROM community_connections WHERE platform = $1 AND external_id = $2',
        ['mattermost', externalId],
      );
      const ciphertext = result.rows[0]?.credentials_ciphertext ?? null;
      if (ciphertext === null) {
        throw new Error(`No sealed credential is stored for Mattermost connection "${externalId}"; reconnect it.`);
      }

      const { serverUrl, teamId } = parseMattermostExternalId(externalId);
      const token = openCommunityCredential(options.keyring, { platform: 'mattermost', externalId }, ciphertext);
      return { serverUrl, teamId, token };
    },

    async close() {
      await pool.end();
    },
  };
}

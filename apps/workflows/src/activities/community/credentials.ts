import {
  type CommunityCredentialKeyring,
  type MattermostTeamTarget,
  openCommunityCredential,
  parseMattermostExternalId,
} from '@reputo/community-api';

/**
 * Opens a sealed community credential at the point of use.
 *
 * The application database stays behind the API: the orchestrator reads the
 * envelope through the `getCommunitySealedCredential` activity and passes it
 * into the fetch, which unseals it here — in the same stack frame as the
 * outbound call. Temporal therefore only ever carries the credential while it
 * is still encrypted and bound to its connection.
 */
export function openMattermostTarget(
  keyring: CommunityCredentialKeyring,
  externalId: string,
  credentialsCiphertext: string,
): MattermostTeamTarget {
  const { serverUrl, teamId } = parseMattermostExternalId(externalId);
  const token = openCommunityCredential(keyring, { platform: 'mattermost', externalId }, credentialsCiphertext);

  return { serverUrl, teamId, token };
}

import type { DeepIdRequester } from '../../api/client.js';
import { DeepIdContractError } from '../../shared/errors/index.js';
import { parseWithContract } from '../../shared/validation/index.js';
import { sealMetadataSchema } from './schemas.js';
import type { SealMetadata } from './types.js';

/**
 * Resolves a `scores_encr['seal-metadata']` value against the configured
 * DeepID application origin. Throws `DeepIdContractError` when the value is
 * empty or lands outside that origin (an absolute URL to another host, a
 * protocol-relative `//host/…`, a non-HTTP scheme) — the client never follows
 * a metadata URL off-origin.
 */
export function resolveSealMetadataUrl(appBaseUrl: string, metadataUrl: string): URL {
  if (typeof metadataUrl !== 'string' || metadataUrl.trim().length === 0) {
    throw new DeepIdContractError('seal metadata URL is missing or empty');
  }
  const origin = new URL(appBaseUrl).origin;
  let resolved: URL;
  try {
    resolved = new URL(metadataUrl, `${origin}/`);
  } catch {
    throw new DeepIdContractError('seal metadata URL cannot be resolved against the DeepID application origin');
  }
  if (resolved.origin !== origin) {
    throw new DeepIdContractError(
      `seal metadata URL resolves to ${resolved.origin}, outside the DeepID application origin ${origin}`,
    );
  }
  return resolved;
}

/**
 * Fetches and validates the public SEAL metadata referenced by
 * `scores_encr['seal-metadata']`. The URL must stay on the configured DeepID
 * application origin and redirects are rejected rather than followed. The
 * response must be a supported (`ckks`) metadata document; `id`, `scale`, and
 * the other fields are validated but never coerced.
 */
export async function getSealMetadata(requester: DeepIdRequester, metadataUrl: string): Promise<SealMetadata> {
  const resolved = resolveSealMetadataUrl(requester.config.appBaseUrl, metadataUrl);
  const response = await requester.request<unknown>('GET', resolved.toString());

  if (response.statusCode >= 300 && response.statusCode < 400) {
    throw new DeepIdContractError(
      `seal metadata request was redirected (HTTP ${response.statusCode}); redirects are not followed`,
    );
  }
  if (response.statusCode !== 200) {
    throw new DeepIdContractError(`seal metadata request returned unexpected HTTP ${response.statusCode}`);
  }
  return parseWithContract(sealMetadataSchema, response.data, 'malformed seal metadata response');
}

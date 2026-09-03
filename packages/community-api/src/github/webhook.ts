import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CommunitySignal, CommunitySignalKind } from '../shared/realtime.js';

/** Header GitHub signs every delivery with. */
export const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256';
export const GITHUB_EVENT_HEADER = 'x-github-event';
/** Unique per delivery; the redelivery of a webhook repeats it. */
export const GITHUB_DELIVERY_HEADER = 'x-github-delivery';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Verifies a delivery's HMAC over the exact bytes GitHub sent. The raw body is
 * required: re-serializing the parsed JSON changes key order and escaping, and
 * the signature would never match.
 *
 * Comparison is constant-time, and a missing or malformed header fails the same
 * way a wrong one does, so the endpoint leaks nothing about the secret.
 */
export function verifyGitHubWebhookSignature(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (secret.length === 0 || signature === undefined || !signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expected = Buffer.from(`${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** The subset of a delivery payload the mapping reads. Everything else is ignored. */
interface GitHubWebhookPayload {
  action?: unknown;
  installation?: { id?: unknown } | null;
  repository?: { name?: unknown } | null;
}

/**
 * Installation-lifecycle actions that end Reputo's access. The probe behind the
 * signal is what reports it — an uninstalled App answers 404 — so this only
 * decides how the signal is described.
 */
const REVOKING_ACTIONS = new Set(['deleted', 'suspend']);

/**
 * Events worth a re-probe, and what they change. `installation` covers the App
 * being removed, suspended, restored, or re-scoped; `installation_repositories`
 * covers a repository being added to or removed from the installation;
 * `repository` covers a repository being renamed, deleted, made private, or
 * having its issue tracker turned off — which is exactly what decides a
 * repository's read verdict.
 */
const SIGNAL_KIND_BY_EVENT: Record<string, CommunitySignalKind> = {
  installation: CommunitySignalKind.community,
  installation_repositories: CommunitySignalKind.resources,
  installation_target: CommunitySignalKind.community,
  repository: CommunitySignalKind.resources,
};

/**
 * Turns one verified delivery into a signal, or nothing when the event says
 * nothing about read access — a `ping`, a push, an issue comment.
 *
 * The installation id is the connection's external id, so a delivery for an
 * installation Reputo does not track resolves to no connection and is dropped
 * by the consumer rather than filtered here.
 */
export function toGitHubWebhookSignal(event: string, payload: unknown): CommunitySignal | null {
  const kind = SIGNAL_KIND_BY_EVENT[event];
  if (kind === undefined) return null;

  const body = (payload ?? {}) as GitHubWebhookPayload;
  const installationId = body.installation?.id;
  if (typeof installationId !== 'number' && typeof installationId !== 'string') return null;

  const action = typeof body.action === 'string' ? body.action : '';
  const revoked = event === 'installation' && REVOKING_ACTIONS.has(action);

  return {
    platform: 'github',
    externalId: String(installationId),
    kind: revoked ? CommunitySignalKind.revoked : kind,
    event: action === '' ? event : `${event}.${action}`,
    at: new Date(),
  };
}

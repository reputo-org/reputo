import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toGitHubWebhookSignal, verifyGitHubWebhookSignature } from '../../../src/github/webhook.js';

const SECRET = 'a-webhook-secret-long-enough';

const sign = (body: string, secret = SECRET): string =>
  `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`;

describe('verifyGitHubWebhookSignature', () => {
  const body = JSON.stringify({ action: 'deleted', installation: { id: 42 } });

  it('accepts a delivery signed with the configured secret', () => {
    expect(verifyGitHubWebhookSignature(SECRET, Buffer.from(body), sign(body))).toBe(true);
  });

  it('refuses a delivery signed with another secret', () => {
    expect(verifyGitHubWebhookSignature(SECRET, Buffer.from(body), sign(body, 'another-secret-entirely'))).toBe(false);
  });

  it('refuses a delivery whose body changed after signing', () => {
    const signature = sign(body);
    const tampered = JSON.stringify({ action: 'deleted', installation: { id: 43 } });

    expect(verifyGitHubWebhookSignature(SECRET, Buffer.from(tampered), signature)).toBe(false);
  });

  it('refuses a missing, unprefixed, or truncated signature the same way', () => {
    const digest = sign(body);

    expect(verifyGitHubWebhookSignature(SECRET, Buffer.from(body), undefined)).toBe(false);
    expect(verifyGitHubWebhookSignature(SECRET, Buffer.from(body), digest.slice('sha256='.length))).toBe(false);
    expect(verifyGitHubWebhookSignature(SECRET, Buffer.from(body), digest.slice(0, -4))).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    expect(verifyGitHubWebhookSignature('', Buffer.from(body), sign(body, ''))).toBe(false);
  });
});

describe('toGitHubWebhookSignal', () => {
  it('reads a repository being added to the installation as a resource change', () => {
    const signal = toGitHubWebhookSignal('installation_repositories', {
      action: 'added',
      installation: { id: 42 },
    });

    expect(signal).toMatchObject({
      platform: 'github',
      externalId: '42',
      kind: 'resources',
      event: 'installation_repositories.added',
    });
  });

  it("reads a repository's own change as a resource change, since it decides the read verdict", () => {
    expect(toGitHubWebhookSignal('repository', { action: 'edited', installation: { id: 42 } })).toMatchObject({
      kind: 'resources',
      event: 'repository.edited',
    });
  });

  it('reads an uninstall or a suspension as lost access', () => {
    expect(toGitHubWebhookSignal('installation', { action: 'deleted', installation: { id: 42 } })).toMatchObject({
      kind: 'revoked',
      event: 'installation.deleted',
    });
    expect(toGitHubWebhookSignal('installation', { action: 'suspend', installation: { id: 42 } })).toMatchObject({
      kind: 'revoked',
    });
  });

  it('reads a restored or re-scoped installation as a community change, not a loss', () => {
    expect(toGitHubWebhookSignal('installation', { action: 'unsuspend', installation: { id: 42 } })).toMatchObject({
      kind: 'community',
    });
    expect(
      toGitHubWebhookSignal('installation', { action: 'new_permissions_accepted', installation: { id: 42 } }),
    ).toMatchObject({ kind: 'community' });
  });

  it('ignores events that say nothing about read access', () => {
    expect(toGitHubWebhookSignal('ping', { zen: 'Non-blocking is better.', installation: { id: 42 } })).toBeNull();
    expect(toGitHubWebhookSignal('push', { installation: { id: 42 } })).toBeNull();
    expect(toGitHubWebhookSignal('issue_comment', { installation: { id: 42 } })).toBeNull();
  });

  it('ignores a delivery that names no installation', () => {
    expect(toGitHubWebhookSignal('installation', { action: 'deleted' })).toBeNull();
    expect(toGitHubWebhookSignal('repository', { action: 'edited', installation: null })).toBeNull();
  });

  it('carries the installation id as a string, whichever way GitHub encodes it', () => {
    expect(toGitHubWebhookSignal('repository', { installation: { id: 42 } })?.externalId).toBe('42');
    expect(toGitHubWebhookSignal('repository', { installation: { id: '42' } })?.externalId).toBe('42');
  });
});

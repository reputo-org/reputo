import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityWebhookRejectedException } from '../../../../src/community';
import { CommunityRealtimeService, CommunityWebhooksController } from '../../../../src/community/realtime';

const SECRET = 'github-app-webhook-test-secret';

function delivery(body: string, overrides: Record<string, string | undefined> = {}) {
  const signature = `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex')}`;
  return {
    headers: {
      'x-hub-signature-256': signature,
      'x-github-event': 'installation_repositories',
      'x-github-delivery': 'delivery-1',
      ...overrides,
    },
    rawBody: Buffer.from(body),
  } as unknown as Request;
}

describe('CommunityWebhooksController', () => {
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };
  const body = JSON.stringify({ action: 'added', installation: { id: 42 } });
  let ingestGitHubDelivery: ReturnType<typeof vi.fn>;

  const makeController = () =>
    new CommunityWebhooksController(
      logger as never,
      { ingestGitHubDelivery } as unknown as CommunityRealtimeService,
      { get: vi.fn(() => SECRET) } as unknown as ConfigService,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    ingestGitHubDelivery = vi.fn().mockResolvedValue(undefined);
  });

  it('accepts a correctly signed delivery and hands it on', () => {
    makeController().receiveGitHubDelivery(delivery(body));

    expect(ingestGitHubDelivery).toHaveBeenCalledWith('installation_repositories', {
      action: 'added',
      installation: { id: 42 },
    });
  });

  it('refuses a delivery signed with the wrong secret', () => {
    const forged = delivery(body, { 'x-hub-signature-256': 'sha256=deadbeef' });

    expect(() => makeController().receiveGitHubDelivery(forged)).toThrow(CommunityWebhookRejectedException);
    expect(ingestGitHubDelivery).not.toHaveBeenCalled();
  });

  it('refuses a delivery whose body was changed after signing', () => {
    const tampered = delivery(body);
    (tampered as unknown as { rawBody: Buffer }).rawBody = Buffer.from(
      JSON.stringify({ action: 'added', installation: { id: 999 } }),
    );

    expect(() => makeController().receiveGitHubDelivery(tampered)).toThrow(CommunityWebhookRejectedException);
  });

  it('refuses a delivery with no signature header', () => {
    const unsigned = delivery(body, { 'x-hub-signature-256': undefined });

    expect(() => makeController().receiveGitHubDelivery(unsigned)).toThrow(CommunityWebhookRejectedException);
  });

  it('refuses a delivery whose raw bytes are unavailable', () => {
    const parsedOnly = delivery(body);
    (parsedOnly as unknown as { rawBody?: Buffer }).rawBody = undefined;

    expect(() => makeController().receiveGitHubDelivery(parsedOnly)).toThrow(CommunityWebhookRejectedException);
  });

  it('refuses an oversized body unread', () => {
    const huge = Buffer.alloc(6 * 1024 * 1024, 0x20);
    const signature = `sha256=${createHmac('sha256', SECRET).update(huge).digest('hex')}`;
    const oversized = delivery(body, { 'x-hub-signature-256': signature });
    (oversized as unknown as { rawBody: Buffer }).rawBody = huge;

    expect(() => makeController().receiveGitHubDelivery(oversized)).toThrow(CommunityWebhookRejectedException);
  });

  it('refuses a signed delivery that is not JSON', () => {
    expect(() => makeController().receiveGitHubDelivery(delivery('not json at all'))).toThrow(
      CommunityWebhookRejectedException,
    );
  });

  it('answers before the probe runs, so a slow platform cannot time the delivery out', async () => {
    let settled = false;
    ingestGitHubDelivery.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 0),
        ),
    );

    makeController().receiveGitHubDelivery(delivery(body));

    expect(settled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(true);
  });

  it('logs rather than throws when handling a delivery fails after the response', async () => {
    ingestGitHubDelivery.mockRejectedValue(new Error('database unreachable'));

    makeController().receiveGitHubDelivery(delivery(body));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: 'delivery-1' }),
      expect.stringContaining('failed'),
    );
  });
});

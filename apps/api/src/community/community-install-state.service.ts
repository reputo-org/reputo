import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CommunityPlatform } from '@reputo/contracts';

interface InstallStatePayload {
  /** Platform the state was minted for. */
  p: CommunityPlatform;
  /** Nonce, so two installs never mint the same value. */
  n: string;
  /** Expiry as epoch milliseconds. */
  e: number;
}

/**
 * Mints and verifies the `state` carried through a platform install redirect.
 *
 * The value is self-contained — payload plus an HMAC over it — so no row is
 * written before the admin returns. Authenticity comes from the signature and
 * freshness from the embedded expiry.
 */
@Injectable()
export class CommunityInstallStateService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>('auth.tokenEncryptionKey') as string;
    this.ttlSeconds = configService.get<number>('community.installStateTtlSeconds') as number;
  }

  issue(platform: CommunityPlatform, now: Date = new Date()): string {
    const payload: InstallStatePayload = {
      p: platform,
      n: randomBytes(16).toString('base64url'),
      e: now.getTime() + this.ttlSeconds * 1000,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    return `${encoded}.${this.sign(encoded)}`;
  }

  /** True only for an untampered, unexpired state minted for this platform. */
  verify(state: string | undefined, platform: CommunityPlatform, now: Date = new Date()): boolean {
    if (!state) return false;

    const [encoded, signature] = state.split('.');
    if (!encoded || !signature || !this.signatureMatches(encoded, signature)) return false;

    const payload = this.decode(encoded);

    return payload !== null && payload.p === platform && payload.e > now.getTime();
  }

  private sign(encoded: string): string {
    return createHmac('sha256', this.secret).update(encoded, 'utf8').digest('base64url');
  }

  private signatureMatches(encoded: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(encoded), 'utf8');
    const received = Buffer.from(signature, 'utf8');

    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private decode(encoded: string): InstallStatePayload | null {
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as InstallStatePayload;
      return typeof payload?.p === 'string' && typeof payload.e === 'number' ? payload : null;
    } catch {
      return null;
    }
  }
}

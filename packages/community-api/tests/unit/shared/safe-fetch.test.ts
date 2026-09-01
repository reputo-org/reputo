import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommunityNetworkError, CommunityOutboundPolicyError } from '../../../src/shared/errors.js';
import { executeRequest } from '../../../src/shared/http.js';
import {
  createPinnedDispatcher,
  executeSafeRequest,
  isBlockedAddress,
  resolvePinnedTarget,
  type SafeFetchLookup,
  type SafeOutboundPolicy,
} from '../../../src/shared/safe-fetch.js';
import { createStubLogger, TEST_HTTP_CONFIG } from '../../utils/mock-helpers.js';

const policy = (overrides: Partial<SafeOutboundPolicy> = {}): SafeOutboundPolicy => ({
  allowedHosts: [],
  maxResponseBytes: 1024,
  ...overrides,
});

const publicLookup: SafeFetchLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.8.8.8', 'loopback range'],
    ['10.1.2.3', 'RFC1918 10/8'],
    ['172.16.0.9', 'RFC1918 172.16/12'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['100.64.0.1', 'CGNAT'],
    ['169.254.169.254', 'link-local cloud metadata'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['198.18.0.1', 'benchmarking'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fe80::1', 'IPv6 link-local'],
    ['fd12::1', 'IPv6 unique-local'],
    ['ff02::1', 'IPv6 multicast'],
    ['64:ff9b::a00:1', 'NAT64'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['not-an-ip', 'unparseable'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['93.184.216.34', 'public IPv4'],
    ['8.8.8.8', 'public IPv4'],
    ['2606:2800:220:1:248:1893:25c8:1946', 'public IPv6'],
    ['::ffff:8.8.8.8', 'IPv4-mapped public'],
  ])('allows %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('resolvePinnedTarget', () => {
  it('rejects a malformed URL', async () => {
    await expect(resolvePinnedTarget('not a url', policy(), publicLookup)).rejects.toBeInstanceOf(
      CommunityOutboundPolicyError,
    );
  });

  it('rejects non-http schemes', async () => {
    await expect(resolvePinnedTarget('ftp://chat.example.com', policy(), publicLookup)).rejects.toThrow(/http\(s\)/);
  });

  it('rejects URLs carrying credentials', async () => {
    await expect(resolvePinnedTarget('https://user:pass@chat.example.com', policy(), publicLookup)).rejects.toThrow(
      /credentials/,
    );
  });

  it('requires HTTPS off the allowlist, before any connection is attempted', async () => {
    await expect(resolvePinnedTarget('http://chat.example.com', policy(), publicLookup)).rejects.toThrow(
      /HTTPS is required/,
    );
  });

  it('rejects private and metadata IP literals', async () => {
    for (const url of [
      'https://127.0.0.1',
      'https://10.0.0.8',
      'https://192.168.1.10:8065',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]:8065',
    ]) {
      await expect(resolvePinnedTarget(url, policy(), publicLookup)).rejects.toThrow(/private or reserved/);
    }
  });

  it('rejects a hostname whose DNS answer is private — the rebinding shape', async () => {
    const rebinding: SafeFetchLookup = async () => [{ address: '10.0.0.5', family: 4 }];

    await expect(resolvePinnedTarget('https://mm.attacker.example', policy(), rebinding)).rejects.toThrow(
      /private or reserved/,
    );
  });

  it('rejects a mixed public/private DNS answer outright', async () => {
    const mixed: SafeFetchLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ];

    await expect(resolvePinnedTarget('https://mm.attacker.example', policy(), mixed)).rejects.toThrow(
      /private or reserved/,
    );
  });

  it('maps a failed resolution to a network error', async () => {
    const failing: SafeFetchLookup = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };

    await expect(resolvePinnedTarget('https://gone.example', policy(), failing)).rejects.toBeInstanceOf(
      CommunityNetworkError,
    );
  });

  it('pins the validated addresses of a public host', async () => {
    const target = await resolvePinnedTarget('https://chat.example.com', policy(), publicLookup);

    expect(target.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(target.url.origin).toBe('https://chat.example.com');
  });

  it('lets an allowlisted host use http and a private address', async () => {
    const allowlisted = policy({ allowedHosts: ['mattermost'] });
    const local: SafeFetchLookup = async () => [{ address: '172.18.0.4', family: 4 }];

    const target = await resolvePinnedTarget('http://mattermost:8065', allowlisted, local);

    expect(target.addresses).toEqual([{ address: '172.18.0.4', family: 4 }]);
  });

  it('matches the allowlist on the hostname, not on the resolved address', async () => {
    const allowlisted = policy({ allowedHosts: ['127.0.0.1'] });
    const rebinding: SafeFetchLookup = async () => [{ address: '127.0.0.1', family: 4 }];

    await expect(resolvePinnedTarget('http://impostor.example', allowlisted, rebinding)).rejects.toThrow(
      /HTTPS is required/,
    );
  });
});

describe('pinned dispatch against a live server', () => {
  let server: Server;
  let port: number;
  const logger = createStubLogger();

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.statusCode = 302;
        response.setHeader('location', 'http://169.254.169.254/latest/meta-data');
        response.end();
        return;
      }
      if (request.url === '/huge') {
        response.setHeader('content-type', 'application/json');
        response.end(`{"blob":"${'x'.repeat(4096)}"}`);
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ host: request.headers.host }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('dials the pinned address instead of resolving the hostname', async () => {
    // .invalid never resolves in real DNS, so a response proves the pin was used.
    const dispatcher = createPinnedDispatcher(
      { url: new URL(`http://reputo-pinned.invalid:${port}/`), addresses: [{ address: '127.0.0.1', family: 4 }] },
      { connectTimeoutMs: 1000 },
    );

    try {
      const response = await executeRequest<{ host: string }>(logger, TEST_HTTP_CONFIG, {
        method: 'GET',
        url: `http://reputo-pinned.invalid:${port}/`,
        dispatcher,
      });
      expect(response.data.host).toBe(`reputo-pinned.invalid:${port}`);
    } finally {
      await dispatcher.close();
    }
  });

  it('refuses a redirect answer instead of following it', async () => {
    await expect(
      executeSafeRequest(logger, TEST_HTTP_CONFIG, policy({ allowedHosts: ['127.0.0.1'] }), {
        method: 'GET',
        url: `http://127.0.0.1:${port}/redirect`,
      }),
    ).rejects.toThrow(/redirect/);
  });

  it('caps the response size', async () => {
    await expect(
      executeSafeRequest(logger, TEST_HTTP_CONFIG, policy({ allowedHosts: ['127.0.0.1'] }), {
        method: 'GET',
        url: `http://127.0.0.1:${port}/huge`,
      }),
    ).rejects.toThrow(/byte cap/);
  });

  it('returns the parsed body inside the policy', async () => {
    const response = await executeSafeRequest<{ host: string }>(
      logger,
      TEST_HTTP_CONFIG,
      policy({ allowedHosts: ['127.0.0.1'], maxResponseBytes: 65536 }),
      { method: 'GET', url: `http://127.0.0.1:${port}/` },
    );

    expect(response.statusCode).toBe(200);
    expect(response.data.host).toBe(`127.0.0.1:${port}`);
  });
});

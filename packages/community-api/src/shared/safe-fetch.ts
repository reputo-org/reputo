import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, type Dispatcher } from 'undici';
import { CommunityNetworkError, CommunityOutboundPolicyError } from './errors.js';
import {
  type CommunityHttpObserver,
  type CommunityLogger,
  executeRequest,
  type HttpRequestOptions,
  type HttpResponse,
} from './http.js';
import type { CommunityHttpConfig } from './types.js';

/**
 * Outbound policy for user-entered origins. Default-deny: private and reserved
 * addresses are refused and HTTPS is required, unless the hostname is on the
 * deployment's allowlist. The allowlist is deployment configuration — never
 * user input — and exists so a dev-compose container or an intentionally
 * internal server can be reached.
 */
export interface SafeOutboundPolicy {
  /** Lowercase hostnames exempt from the HTTPS and public-address rules. */
  allowedHosts: readonly string[];
  /** Cap on response body bytes. */
  maxResponseBytes: number;
}

export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Injectable resolver so tests can simulate DNS rebinding without real DNS. */
export type SafeFetchLookup = (hostname: string) => Promise<ResolvedAddress[]>;

/** A validated URL together with the only addresses a socket may dial. */
export interface PinnedTarget {
  url: URL;
  addresses: ResolvedAddress[];
}

/**
 * Private, link-local (including cloud metadata), CGNAT, and reserved ranges.
 * Table-driven so the policy tests enumerate exactly what is refused.
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
];

const BLOCKED_IPV6_RANGES: ReadonlyArray<[string, number]> = [
  ['::', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

const blockedRanges = new BlockList();
for (const [net, prefix] of BLOCKED_IPV4_RANGES) blockedRanges.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of BLOCKED_IPV6_RANGES) blockedRanges.addSubnet(net, prefix, 'ipv6');

const IPV4_MAPPED_DOTTED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
/** `URL` canonicalizes `[::ffff:127.0.0.1]` to `::ffff:7f00:1`, so both forms arrive here. */
const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

/** The IPv4 address an IPv4-mapped IPv6 address actually reaches, in either notation. */
function toMappedIpv4(address: string): string | undefined {
  const dotted = IPV4_MAPPED_DOTTED.exec(address);
  if (dotted) return dotted[1];

  const hex = IPV4_MAPPED_HEX.exec(address);
  if (!hex) return undefined;

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** True for any address the policy refuses to dial. Unparseable input is refused. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return blockedRanges.check(address);

  // An IPv4-mapped IPv6 address reaches the IPv4 network, so it is judged as
  // that IPv4 address. Node's BlockList maps them onto the IPv4 rules too;
  // decoding here keeps the policy independent of that behavior.
  const mapped = toMappedIpv4(address);
  if (mapped !== undefined) return blockedRanges.check(mapped);
  return blockedRanges.check(address, 'ipv6');
}

const defaultLookup: SafeFetchLookup = async (hostname) => lookup(hostname, { all: true, verbatim: true });

/** `URL#hostname` keeps the brackets of an IPv6 literal; policy checks do not want them. */
function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * Validates a user-entered URL against the outbound policy and resolves it to
 * the addresses the connection is allowed to dial. Resolution happens exactly
 * once — the returned addresses are what the socket connects to, so a DNS
 * answer that changes after this check cannot redirect the request.
 */
export async function resolvePinnedTarget(
  rawUrl: string,
  policy: SafeOutboundPolicy,
  resolve: SafeFetchLookup = defaultLookup,
): Promise<PinnedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CommunityOutboundPolicyError('The server URL is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CommunityOutboundPolicyError('Only http(s) server URLs are allowed.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new CommunityOutboundPolicyError('Server URLs must not carry credentials.');
  }

  const hostname = bareHostname(url);
  const allowlisted = policy.allowedHosts.includes(hostname);

  if (!allowlisted && url.protocol !== 'https:') {
    throw new CommunityOutboundPolicyError('HTTPS is required for servers outside the deployment allowlist.');
  }

  let addresses: ResolvedAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new CommunityNetworkError(`The hostname "${hostname}" could not be resolved.`);
    }
  }
  if (addresses.length === 0) {
    throw new CommunityNetworkError(`The hostname "${hostname}" resolved to no addresses.`);
  }

  // One private answer poisons the whole set: an attacker who controls the DNS
  // answer must not be able to mix a public and a private record.
  if (!allowlisted && addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new CommunityOutboundPolicyError('The server resolves to a private or reserved address, which is blocked.');
  }

  return { url, addresses };
}

type LookupCallback = (
  error: Error | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * Dispatcher that dials only the pinned addresses, whatever DNS says by the
 * time the socket opens. TLS still verifies against the hostname — pinning
 * replaces the address lookup, not the server identity check.
 */
export function createPinnedDispatcher(target: PinnedTarget, options: { connectTimeoutMs: number }): Dispatcher {
  const pinnedLookup = (_hostname: string, lookupOptions: { all?: boolean }, callback: LookupCallback): void => {
    const entries = target.addresses.map(({ address, family }) => ({ address, family }));
    if (lookupOptions?.all === true) {
      callback(null, entries);
    } else {
      callback(null, entries[0].address, entries[0].family);
    }
  };

  // undici never follows redirects unless the redirect interceptor is composed
  // in; `executeSafeRequest` additionally rejects any 3xx it receives.
  return new Agent({
    connect: { lookup: pinnedLookup, timeout: options.connectTimeoutMs },
  });
}

/**
 * The one outbound path for user-entered origins: policy check, pinned
 * connection, refused redirects, capped response. Every call site of a
 * platform with admin-supplied URLs must go through here.
 */
export async function executeSafeRequest<T>(
  logger: CommunityLogger,
  config: CommunityHttpConfig,
  policy: SafeOutboundPolicy,
  options: HttpRequestOptions,
  observer?: CommunityHttpObserver,
): Promise<HttpResponse<T>> {
  const target = await resolvePinnedTarget(options.url, policy);
  const dispatcher = createPinnedDispatcher(target, { connectTimeoutMs: config.requestTimeoutMs });

  try {
    return await executeRequest<T>(
      logger,
      config,
      {
        ...options,
        dispatcher,
        rejectRedirects: true,
        maxResponseBytes: policy.maxResponseBytes,
      },
      observer,
    );
  } finally {
    await dispatcher.close();
  }
}

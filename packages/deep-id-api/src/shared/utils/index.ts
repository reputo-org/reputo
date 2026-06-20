/** DeepID identifier format accepted by `/v1` endpoints: `did:sub:…` or `did:plc:…`. */
const DID_PATTERN = /^did:(plc|sub):[a-zA-Z0-9]{24}$/;

/** True when `value` is a well-formed DeepID identifier (`did:(plc|sub):[a-zA-Z0-9]{24}`). */
export function isValidDid(value: unknown): value is string {
  return typeof value === 'string' && DID_PATTERN.test(value);
}

/** Split `items` into chunks of at most `size` (used to size `postScores` requests defensively). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('chunk size must be a positive integer');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

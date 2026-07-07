import { describe, expect, it } from 'vitest';
import { chunk, isValidDid, trimTrailingSlash } from '../../../src/shared/utils/index.js';

describe('isValidDid', () => {
  it('accepts did:sub and did:plc with 24 alphanumerics', () => {
    expect(isValidDid('did:sub:abc123ABC123abc123ABC123')).toBe(true);
    expect(isValidDid('did:plc:abc123ABC123abc123ABC123')).toBe(true);
  });

  it('rejects wrong prefix, wrong length, and non-strings', () => {
    expect(isValidDid('did:web:abc123ABC123abc123ABC123')).toBe(false);
    expect(isValidDid('did:sub:tooshort')).toBe(false);
    expect(isValidDid('did:sub:abc123ABC123abc123ABC1234')).toBe(false);
    expect(isValidDid('not-a-did')).toBe(false);
    expect(isValidDid(undefined)).toBe(false);
    expect(isValidDid(42)).toBe(false);
  });
});

describe('chunk', () => {
  it('splits into chunks of at most size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns an empty array for empty input', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('throws on non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('trimTrailingSlash', () => {
  it('removes a single trailing slash', () => {
    expect(trimTrailingSlash('https://x/')).toBe('https://x');
    expect(trimTrailingSlash('https://x')).toBe('https://x');
  });
});

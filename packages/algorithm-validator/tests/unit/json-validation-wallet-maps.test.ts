import { describe, expect, it } from 'vitest';
import { validateJSONContent } from '../../src/json-validation.js';
import type { JsonIoItem } from '../../src/types/index.js';

const walletAddressMapConfig: NonNullable<JsonIoItem['json']> = {
  maxBytes: 1024,
  schema: 'wallet_address_map',
  allowedChains: ['ethereum', 'cardano'],
};

describe('validateJSONContent — wallet_address_map', () => {
  it('accepts a valid wallets object with both chains', async () => {
    const result = await validateJSONContent(
      JSON.stringify({
        wallets: {
          ethereum: ['0x1234567890abcdef1234567890abcdef12345678'],
          cardano: ['addr1q9examplexamplexamplexamplexamplexample'],
        },
      }),
      walletAddressMapConfig,
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects when the root has unexpected top-level keys', async () => {
    const result = await validateJSONContent(
      JSON.stringify({ wallets: { ethereum: ['0x1234567890abcdef1234567890abcdef12345678'] }, extra: true }),
      walletAddressMapConfig,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('top-level key'))).toBe(true);
  });

  it('rejects unsupported chain keys', async () => {
    const result = await validateJSONContent(JSON.stringify({ wallets: { solana: ['abc'] } }), {
      ...walletAddressMapConfig,
      allowedChains: ['ethereum'],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unsupported wallet chain'))).toBe(true);
  });

  it('rejects malformed wallet entries', async () => {
    const result = await validateJSONContent(
      JSON.stringify({
        wallets: {
          ethereum: ['not-an-address'],
          cardano: ['not-a-cardano-address'],
        },
      }),
      walletAddressMapConfig,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('valid Ethereum address'))).toBe(true);
    expect(result.errors.some((e) => e.includes('valid Cardano payment address'))).toBe(true);
  });

  it('rejects duplicate addresses (case-insensitive on ethereum)', async () => {
    const result = await validateJSONContent(
      JSON.stringify({
        wallets: {
          ethereum: ['0x1234567890ABCDEF1234567890abcdef12345678', '0x1234567890abcdef1234567890abcdef12345678'],
        },
      }),
      walletAddressMapConfig,
    );

    expect(result.errors.some((e) => e.includes('duplicate address'))).toBe(true);
  });

  it('rejects empty wallet maps', async () => {
    const result = await validateJSONContent(JSON.stringify({ wallets: {} }), walletAddressMapConfig);
    expect(result.errors).toContain('Wallet JSON must contain at least one wallet address');
  });

  it('rejects non-array chain values', async () => {
    const result = await validateJSONContent(
      JSON.stringify({ wallets: { ethereum: 'not-an-array' } }),
      walletAddressMapConfig,
    );
    expect(result.errors.some((e) => e.includes('must be an array'))).toBe(true);
  });

  it('uses a custom rootKey when provided in config', async () => {
    const result = await validateJSONContent(
      JSON.stringify({
        addresses: {
          ethereum: ['0x1234567890abcdef1234567890abcdef12345678'],
        },
      }),
      { ...walletAddressMapConfig, rootKey: 'addresses' } as JsonIoItem['json'],
    );

    expect(result.valid).toBe(true);
  });
});

describe('validateJSONContent — general failures', () => {
  it('rejects an empty body', async () => {
    const result = await validateJSONContent('', walletAddressMapConfig);
    expect(result.errors).toContain('JSON file is empty');
  });

  it('rejects malformed JSON', async () => {
    const result = await validateJSONContent('{not valid', walletAddressMapConfig);
    expect(result.errors.some((e) => e.startsWith('Failed to parse JSON'))).toBe(true);
  });

  it('rejects oversized payloads when maxBytes is configured', async () => {
    const body = JSON.stringify({ wallets: { ethereum: ['0x1234567890abcdef1234567890abcdef12345678'] } });
    const result = await validateJSONContent(body, { ...walletAddressMapConfig, maxBytes: 1 });
    expect(result.errors.some((e) => e.includes('exceeds algorithm limit'))).toBe(true);
  });

  it('accepts any JSON object when no schema is configured', async () => {
    const result = await validateJSONContent(JSON.stringify({ anything: 1 }));
    expect(result.valid).toBe(true);
  });

  it('rejects non-object JSON when no schema is configured', async () => {
    const result = await validateJSONContent('[]');
    expect(result.errors).toContain('JSON root must be an object');
  });
});

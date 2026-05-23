import { describe, expect, it } from 'vitest';
import { parseContentTypeAllowlist, storageEnvSchema } from '../src/storage.js';

describe('storageEnvSchema', () => {
  it('parses bucket with all defaults applied', () => {
    expect(storageEnvSchema.parse({ STORAGE_BUCKET: 'algo-inputs' })).toEqual({
      STORAGE_BUCKET: 'algo-inputs',
      STORAGE_PRESIGN_PUT_TTL: 120,
      STORAGE_PRESIGN_GET_TTL: 300,
      STORAGE_MAX_SIZE_BYTES: 52_428_800,
      STORAGE_CONTENT_TYPE_ALLOWLIST: 'text/csv,text/plain,application/json',
    });
  });

  it('coerces string numbers from env into actual numbers', () => {
    const parsed = storageEnvSchema.parse({
      STORAGE_BUCKET: 'algo-inputs',
      STORAGE_PRESIGN_PUT_TTL: '60',
      STORAGE_PRESIGN_GET_TTL: '180',
      STORAGE_MAX_SIZE_BYTES: '1024',
    });
    expect(parsed.STORAGE_PRESIGN_PUT_TTL).toBe(60);
    expect(parsed.STORAGE_PRESIGN_GET_TTL).toBe(180);
    expect(parsed.STORAGE_MAX_SIZE_BYTES).toBe(1024);
  });

  it('rejects a zero or negative TTL', () => {
    expect(() => storageEnvSchema.parse({ STORAGE_BUCKET: 'b', STORAGE_PRESIGN_PUT_TTL: '0' })).toThrow();
    expect(() => storageEnvSchema.parse({ STORAGE_BUCKET: 'b', STORAGE_MAX_SIZE_BYTES: '-1' })).toThrow();
  });

  it('requires STORAGE_BUCKET', () => {
    expect(() => storageEnvSchema.parse({})).toThrow();
  });

  it('rejects an empty allowlist string', () => {
    expect(() => storageEnvSchema.parse({ STORAGE_BUCKET: 'b', STORAGE_CONTENT_TYPE_ALLOWLIST: '' })).toThrow();
  });
});

describe('parseContentTypeAllowlist', () => {
  it('splits and trims a CSV', () => {
    expect(parseContentTypeAllowlist(' text/csv , text/plain ')).toEqual(['text/csv', 'text/plain']);
  });

  it('drops empty entries from trailing commas', () => {
    expect(parseContentTypeAllowlist('text/csv,,text/plain,')).toEqual(['text/csv', 'text/plain']);
  });
});

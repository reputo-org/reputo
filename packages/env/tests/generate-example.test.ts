import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { awsEnvSchema } from '../src/aws.js';
import { generateEnvExample } from '../src/generate-example.js';
import { runtimeEnvSchema } from '../src/runtime.js';
import { secretString } from '../src/secret.js';
import { storageEnvSchema } from '../src/storage.js';

describe('generateEnvExample', () => {
  it('renders required keys with empty values and descriptions as comments', () => {
    const out = generateEnvExample(runtimeEnvSchema);
    expect(out).toContain('# Node runtime environment');
    expect(out).toContain('NODE_ENV=');
    expect(out).toContain('# Pino log level');
    expect(out).toContain('LOG_LEVEL=info');
  });

  it('renders defaults inline for defaulted fields', () => {
    const out = generateEnvExample(storageEnvSchema);
    expect(out).toContain('STORAGE_BUCKET=');
    expect(out).toContain('STORAGE_PRESIGN_PUT_TTL=120');
    expect(out).toContain('STORAGE_PRESIGN_GET_TTL=300');
    expect(out).toContain('STORAGE_MAX_SIZE_BYTES=52428800');
    expect(out).toContain('STORAGE_CONTENT_TYPE_ALLOWLIST=text/csv,text/plain,application/json');
  });

  it('renders pure optionals as commented-out placeholders', () => {
    const out = generateEnvExample(awsEnvSchema);
    expect(out).toContain('AWS_REGION=');
    expect(out).toMatch(/^# AWS_ACCESS_KEY_ID=$/m);
    expect(out).toMatch(/^# AWS_SECRET_ACCESS_KEY=$/m);
  });

  it('supports a header and a trailing-newline override', () => {
    const out = generateEnvExample(runtimeEnvSchema, {
      header: '# === runtime ===',
      trailingNewline: false,
    });
    expect(out.startsWith('# === runtime ===')).toBe(true);
    expect(out.endsWith('\n')).toBe(false);
  });

  it('walks merged schemas', () => {
    const merged = runtimeEnvSchema.extend({
      EXTRA_TOKEN: secretString('Extra token'),
    });
    const out = generateEnvExample(merged);
    expect(out).toContain('# Extra token');
    expect(out).toContain('EXTRA_TOKEN=');
  });

  it('throws when given a non-object schema', () => {
    expect(() => generateEnvExample(z.string())).toThrow(TypeError);
  });
});

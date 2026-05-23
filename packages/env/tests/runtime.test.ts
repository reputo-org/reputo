import { describe, expect, it } from 'vitest';
import { LOG_LEVELS, NODE_ENVS, runtimeEnvSchema } from '../src/runtime.js';

describe('runtimeEnvSchema', () => {
  it('parses a valid env', () => {
    expect(runtimeEnvSchema.parse({ NODE_ENV: 'development', LOG_LEVEL: 'debug' })).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug',
    });
  });

  it('defaults LOG_LEVEL to info when missing', () => {
    expect(runtimeEnvSchema.parse({ NODE_ENV: 'production' })).toEqual({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });
  });

  it('requires NODE_ENV', () => {
    expect(() => runtimeEnvSchema.parse({})).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => runtimeEnvSchema.parse({ NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => runtimeEnvSchema.parse({ NODE_ENV: 'test', LOG_LEVEL: 'shout' })).toThrow();
  });

  it('exposes its enum tuples', () => {
    expect(NODE_ENVS).toContain('production');
    expect(LOG_LEVELS).toContain('info');
  });
});

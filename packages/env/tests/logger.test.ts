import { describe, expect, it } from 'vitest';
import { LOG_LEVELS, loggerEnvSchema } from '../src/logger.js';

describe('loggerEnvSchema', () => {
  it('defaults LOG_LEVEL to info', () => {
    expect(loggerEnvSchema.parse({})).toEqual({ LOG_LEVEL: 'info' });
  });

  it('accepts every Pino level in the catalog', () => {
    for (const level of LOG_LEVELS) {
      expect(loggerEnvSchema.parse({ LOG_LEVEL: level })).toEqual({ LOG_LEVEL: level });
    }
  });

  it('rejects unknown levels', () => {
    expect(() => loggerEnvSchema.parse({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});

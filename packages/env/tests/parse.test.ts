import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, parseEnv, parseEnvOrExit } from '../src/parse.js';

const schema = z.object({
  PORT: z.coerce.number().int().positive(),
  HOST: z.string().min(1),
});

describe('parseEnv', () => {
  it('returns parsed config on success', () => {
    expect(parseEnv(schema, { PORT: '3000', HOST: 'localhost' })).toEqual({
      PORT: 3000,
      HOST: 'localhost',
    });
  });

  it('throws EnvValidationError listing each bad key', () => {
    try {
      parseEnv(schema, { PORT: '-1' });
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const err = error as EnvValidationError;
      expect(err.message).toMatch(/PORT:/);
      expect(err.message).toMatch(/HOST:/);
      expect(err.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('parseEnvOrExit', () => {
  it('returns parsed config on success', () => {
    const exit = vi.fn(() => undefined as never);
    expect(parseEnvOrExit(schema, { PORT: '8080', HOST: 'api' }, exit)).toEqual({
      PORT: 8080,
      HOST: 'api',
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it('writes the formatted error to stderr and exits with 1 on failure', () => {
    const exit = vi.fn(() => undefined as never);
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      parseEnvOrExit(schema, { PORT: 'nope' }, exit);
      expect(writeSpy).toHaveBeenCalled();
      expect(writeSpy.mock.calls[0]?.[0]).toMatch(/Invalid environment variables/);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      writeSpy.mockRestore();
    }
  });
});

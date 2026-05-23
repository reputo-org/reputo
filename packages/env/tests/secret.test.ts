import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { secretString } from '../src/secret.js';

describe('secretString', () => {
  it('accepts a non-empty string', () => {
    const schema = secretString();
    expect(schema.parse('shhh')).toBe('shhh');
  });

  it('rejects an empty string', () => {
    const schema = secretString();
    expect(() => schema.parse('')).toThrow();
  });

  it('rejects non-strings', () => {
    const schema = secretString();
    expect(() => schema.parse(undefined)).toThrow();
    expect(() => schema.parse(123 as unknown as string)).toThrow();
  });

  it('propagates the description through .describe()', () => {
    const schema = secretString('My secret');
    expect(schema.description).toBe('My secret');
  });

  it('composes inside an object schema and rejects empty values', () => {
    const env = z.object({ TOKEN: secretString() });
    expect(() => env.parse({ TOKEN: '' })).toThrow();
    expect(env.parse({ TOKEN: 'abc' })).toEqual({ TOKEN: 'abc' });
  });
});

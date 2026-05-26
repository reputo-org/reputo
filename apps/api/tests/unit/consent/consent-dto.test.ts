import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ConsentCallbackQueryDto, ConsentInitiateQueryDto } from '../../../src/consent/dto';

async function validateQuery<T extends object>(type: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('OAuth consent DTO validation', () => {
  it('accepts the callback scope query parameter echoed by the provider', async () => {
    const errors = await validateQuery(ConsentCallbackQueryDto, {
      code: 'authorization-code',
      state: 'state',
      scope: 'api wallets profile',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects unexpected callback query parameters', async () => {
    const errors = await validateQuery(ConsentCallbackQueryDto, {
      code: 'authorization-code',
      state: 'state',
      unexpected: 'value',
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing and empty initiate source values', async () => {
    const missingErrors = await validateQuery(ConsentInitiateQueryDto, {});
    const emptyErrors = await validateQuery(ConsentInitiateQueryDto, { source: '' });

    expect(missingErrors.length).toBeGreaterThan(0);
    expect(emptyErrors.length).toBeGreaterThan(0);
  });
});

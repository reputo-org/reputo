import { describe, expect, it } from 'vitest';
import { awsEnvSchema } from '../src/aws.js';

describe('awsEnvSchema', () => {
  it('accepts region alone (IAM-role path)', () => {
    expect(awsEnvSchema.parse({ AWS_REGION: 'eu-central-1' })).toEqual({
      AWS_REGION: 'eu-central-1',
    });
  });

  it('accepts a full access-key pair', () => {
    const parsed = awsEnvSchema.parse({
      AWS_REGION: 'eu-central-1',
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret',
    });
    expect(parsed.AWS_ACCESS_KEY_ID).toBe('AKIAEXAMPLE');
    expect(parsed.AWS_SECRET_ACCESS_KEY).toBe('secret');
  });

  it('rejects only the access key id without the secret', () => {
    expect(() => awsEnvSchema.parse({ AWS_REGION: 'eu-central-1', AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE' })).toThrow(
      /together or both omitted/,
    );
  });

  it('rejects only the secret without the access key id', () => {
    expect(() => awsEnvSchema.parse({ AWS_REGION: 'eu-central-1', AWS_SECRET_ACCESS_KEY: 'secret' })).toThrow(
      /together or both omitted/,
    );
  });

  it('rejects an empty AWS_REGION', () => {
    expect(() => awsEnvSchema.parse({ AWS_REGION: '' })).toThrow();
  });

  it('rejects empty-string secrets (vs the legacy Joi .allow("") behaviour)', () => {
    expect(() =>
      awsEnvSchema.parse({
        AWS_REGION: 'eu-central-1',
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
      }),
    ).toThrow();
  });
});

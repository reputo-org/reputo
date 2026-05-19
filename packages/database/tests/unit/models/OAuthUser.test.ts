import { beforeEach, describe, expect, test } from 'vitest';
import OAuthUserModel from '../../../src/models/OAuthUser.model.js';
import { MODEL_NAMES, OAuthProviderDeepId } from '../../../src/shared/constants/index.js';
import type { OAuthUser } from '../../../src/shared/types/index.js';

describe('OAuthUser model', () => {
  describe('OAuthUser validation', () => {
    let oauthUser: OAuthUser;

    beforeEach(() => {
      oauthUser = {
        provider: OAuthProviderDeepId,
        sub: 'did:plc:pwtlzekayxk67odbhen6v2bb',
        aud: ['9cad9abe-1dc6-4c66-acac-f747026c3beb'],
        auth_time: 1775166617,
        email: 'User@Example.com',
        email_verified: true,
        iat: 1775166619,
        iss: 'https://identity.staging.deep-id.ai',
        picture: 'https://example.com/avatar.png',
        rat: 1775166617,
        username: 'ada',
      };
    });

    test('should correctly validate a valid OAuth user', async () => {
      const doc = new OAuthUserModel(oauthUser);

      await expect(doc.validate()).resolves.toBeUndefined();
      expect(doc.email).toBe('user@example.com');
    });
  });

  describe('OAuthUser indexes', () => {
    test('should define the provider and sub compound unique index', () => {
      const indexes = OAuthUserModel.schema.indexes();
      const providerSubIndex = indexes.find(([fields]) => fields.provider === 1 && fields.sub === 1);

      expect(providerSubIndex?.[1]).toMatchObject({ unique: true });
    });

    test('should not define a unique email index', () => {
      const indexes = OAuthUserModel.schema.indexes();
      const emailIndex = indexes.find(([fields]) => fields.email === 1);

      expect(emailIndex).toBeUndefined();
    });
  });

  describe('OAuthUser exports', () => {
    test('should be registered with the correct model name', () => {
      expect(OAuthUserModel.modelName).toBe(MODEL_NAMES.OAUTH_USER);
    });

    test('should use the OAuthUserSchema', () => {
      expect(OAuthUserModel.schema).toBeDefined();
      expect(OAuthUserModel.schema.path('sub')).toBeDefined();
      expect(OAuthUserModel.schema.path('provider')).toBeDefined();
    });

    test('should re-export through the models barrel', async () => {
      const models = await import('../../../src/models/index.js');
      expect(models.OAuthUserModel).toBe(OAuthUserModel);
    });

    test('should re-export through the package barrel as OAuthUserModelValue', async () => {
      const pkg = await import('../../../src/index.js');
      expect(pkg.OAuthUserModelValue).toBe(OAuthUserModel);
    });

    test('should re-export the OAuthUserSchema through the package barrel', async () => {
      const pkg = await import('../../../src/index.js');
      expect(pkg.OAuthUserSchema).toBe(OAuthUserModel.schema);
    });
  });
});

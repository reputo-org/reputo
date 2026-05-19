import { registerAs } from '@nestjs/config';
import { OAUTH_PROVIDERS, type OAuthProvider, OAuthProviderDeepId } from '@reputo/database';
import * as Joi from 'joi';
import { AUTH_MODE_MOCK, AUTH_MODE_OAUTH } from '../shared/constants';

export interface OAuthProviderAuthConfig {
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  redirectUri: string;
  scope: string;
}

export interface AuthConfig {
  appPublicUrl: string;
  cookieDomain?: string;
  cookieName: string;
  cookieSameSite: string;
  cookieSecure: boolean;
  mode: string;
  ownerEmail?: string;
  ownerProvider: OAuthProvider;
  providers: Record<OAuthProvider, OAuthProviderAuthConfig>;
  refreshLeewaySeconds: number;
  sessionTtlSeconds: number;
  tokenEncryptionKey: string;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null || value === '') {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
}

function parseOwnerProvider(raw: string | undefined): OAuthProvider {
  const candidate = (raw ?? OAuthProviderDeepId).toLowerCase();
  return (OAUTH_PROVIDERS as readonly string[]).includes(candidate)
    ? (candidate as OAuthProvider)
    : OAuthProviderDeepId;
}

const ownerEmailSchema = Joi.string().trim().lowercase().email();

export default registerAs(
  'auth',
  (): AuthConfig => ({
    mode: (process.env.AUTH_MODE ?? AUTH_MODE_OAUTH).toLowerCase(),
    ownerEmail: process.env.OWNER_EMAIL?.trim().toLowerCase() || undefined,
    ownerProvider: parseOwnerProvider(process.env.OWNER_PROVIDER),
    providers: {
      [OAuthProviderDeepId]: {
        issuerUrl: process.env.DEEP_ID_ISSUER_URL as string,
        clientId: process.env.DEEP_ID_CLIENT_ID as string,
        clientSecret: process.env.DEEP_ID_CLIENT_SECRET as string,
        redirectUri: process.env.DEEP_ID_AUTH_REDIRECT_URI as string,
        scope: process.env.DEEP_ID_AUTH_SCOPES as string,
      },
    },
    cookieName: process.env.AUTH_COOKIE_NAME as string,
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,
    cookieSecure: parseBoolean(process.env.AUTH_COOKIE_SECURE, process.env.NODE_ENV === 'production'),
    cookieSameSite: (process.env.AUTH_COOKIE_SAME_SITE ?? 'lax').toLowerCase(),
    sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30),
    refreshLeewaySeconds: Number(process.env.AUTH_REFRESH_LEEWAY_SECONDS ?? 60),
    tokenEncryptionKey: process.env.AUTH_TOKEN_ENCRYPTION_KEY as string,
    appPublicUrl: process.env.APP_PUBLIC_URL as string,
  }),
);

export const authConfigSchema = {
  AUTH_MODE: Joi.when('NODE_ENV', {
    is: 'production',
    // biome-ignore lint/suspicious/noThenProperty: Joi conditional schemas require a then key.
    then: Joi.string().valid(AUTH_MODE_OAUTH).default(AUTH_MODE_OAUTH).messages({
      'any.only': 'AUTH_MODE=mock is not permitted when NODE_ENV=production.',
    }),
    otherwise: Joi.string().valid(AUTH_MODE_OAUTH, AUTH_MODE_MOCK).default(AUTH_MODE_OAUTH),
  }).description('Authentication mode'),
  OWNER_EMAIL: Joi.when('AUTH_MODE', {
    is: AUTH_MODE_OAUTH,
    // biome-ignore lint/suspicious/noThenProperty: Joi conditional schemas require a then key.
    then: ownerEmailSchema.required(),
    otherwise: ownerEmailSchema.allow('').optional(),
  }).description('Email address seeded as an owner allowlist entry on bootstrap'),
  OWNER_PROVIDER: Joi.string()
    .trim()
    .lowercase()
    .valid(...OAUTH_PROVIDERS)
    .default(OAuthProviderDeepId)
    .description('Provider against which OWNER_EMAIL is seeded'),
  DEEP_ID_ISSUER_URL: Joi.string().uri().required().description('Deep ID issuer base URL'),
  DEEP_ID_CLIENT_ID: Joi.string().trim().required().description('Deep ID OAuth client identifier'),
  DEEP_ID_CLIENT_SECRET: Joi.string().trim().required().description('Deep ID OAuth client secret'),
  DEEP_ID_AUTH_REDIRECT_URI: Joi.string().uri().required().description('Deep ID OAuth auth callback URL'),
  DEEP_ID_AUTH_SCOPES: Joi.string().trim().required().description('Space or comma separated Deep ID auth scopes'),
  AUTH_COOKIE_NAME: Joi.string().trim().required().description('Opaque auth session cookie name'),
  AUTH_COOKIE_DOMAIN: Joi.string().allow('').optional().description('Optional cookie domain override'),
  AUTH_COOKIE_SECURE: Joi.boolean()
    .truthy('true')
    .truthy('1')
    .falsy('false')
    .falsy('0')
    .default(false)
    .description('Whether auth cookies require HTTPS'),
  AUTH_COOKIE_SAME_SITE: Joi.string()
    .valid('lax', 'strict', 'none', 'Lax', 'Strict', 'None')
    .default('lax')
    .description('Auth cookie SameSite policy'),
  AUTH_SESSION_TTL_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(60 * 60 * 24 * 30)
    .description('Maximum opaque session lifetime in seconds'),
  AUTH_REFRESH_LEEWAY_SECONDS: Joi.number()
    .integer()
    .min(0)
    .default(60)
    .description('Seconds before access token expiry when refresh should happen'),
  AUTH_TOKEN_ENCRYPTION_KEY: Joi.string()
    .trim()
    .min(32)
    .required()
    .description('Secret used to encrypt provider tokens and transient auth flow cookies'),
  APP_PUBLIC_URL: Joi.string().uri().required().description('Public application URL used after login'),
};

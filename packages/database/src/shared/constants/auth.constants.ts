export const OAuthProviderDeepId = 'deep-id' as const;
export type OAuthProviderDeepId = typeof OAuthProviderDeepId;

export const OAUTH_PROVIDERS = [OAuthProviderDeepId] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const ACCESS_ROLE_OWNER = 'owner' as const;
export const ACCESS_ROLE_ADMIN = 'admin' as const;
export const ACCESS_ROLES = [ACCESS_ROLE_OWNER, ACCESS_ROLE_ADMIN] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

export const AUTH_SESSION_PRIVATE_FIELDS = [
  'accessTokenCiphertext',
  'refreshTokenCiphertext',
  'state',
  'codeVerifier',
] as const;
export type AuthSessionPrivateField = (typeof AUTH_SESSION_PRIVATE_FIELDS)[number];

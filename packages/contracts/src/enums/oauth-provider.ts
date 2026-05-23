export const OAuthProviderDeepId = 'deep-id' as const;
export type OAuthProviderDeepId = typeof OAuthProviderDeepId;

export const OAUTH_PROVIDERS = [OAuthProviderDeepId] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

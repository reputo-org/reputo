/**
 * Fields on a stored auth session that hold secrets or single-use ceremony
 * material. Listed here so that any DTO layer projecting an `AuthSession`
 * across the API/Workflows boundary can strip them.
 */
export const AUTH_SESSION_PRIVATE_FIELDS = [
  'accessTokenCiphertext',
  'refreshTokenCiphertext',
  'state',
  'codeVerifier',
] as const;
export type AuthSessionPrivateField = (typeof AUTH_SESSION_PRIVATE_FIELDS)[number];

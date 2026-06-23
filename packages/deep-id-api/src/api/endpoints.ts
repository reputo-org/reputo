/**
 * `token` is served by the identity host; the `/v1/...` endpoints by the
 * application host (see {@link DeepIdApiConfig.identityBaseUrl} /
 * {@link DeepIdApiConfig.appBaseUrl}).
 */
export const endpoints = {
  token: () => '/oauth2/token',
  users: () => '/v1/users',
  user: () => '/v1/user',
  clientsScores: () => '/v1/clients/scores',
} as const;

export type EndpointKey = keyof typeof endpoints;

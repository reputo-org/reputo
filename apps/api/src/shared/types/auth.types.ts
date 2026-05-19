import type { AccessRole, OAuthProvider } from '@reputo/database';

export interface OAuthDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

export interface OAuthUserInfo {
  aud?: string | string[];
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  iat?: number;
  iss?: string;
  picture?: string;
  rat?: number;
  sub?: string;
  username?: string;
  [key: string]: unknown;
}

export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export interface AuthFlowState {
  provider: OAuthProvider;
  state: string;
  codeVerifier: string;
}

export interface SessionUserView {
  id: string;
  provider: OAuthProvider;
  role: AccessRole;
  sub: string;
  aud?: string[];
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  iat?: number;
  iss?: string;
  picture?: string;
  rat?: number;
  username?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CurrentSessionView {
  authenticated: boolean;
  provider?: OAuthProvider;
  role?: AccessRole;
  expiresAt?: string;
  scope?: string[];
  user?: SessionUserView;
}

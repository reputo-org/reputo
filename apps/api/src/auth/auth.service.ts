import { BadGatewayException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACCESS_ROLE_OWNER, type AccessRole, type OAuthProvider } from '@reputo/database';
import type { Request, Response } from 'express';
import { AdminService } from '../admin';
import { AuthSessionRepository, type AuthSessionWithSecrets } from '../sessions';
import { AUTH_MODE_MOCK, AUTH_MODE_OAUTH } from '../shared/constants';
import {
  type AuthFlowState,
  type AuthRequestContext,
  type CurrentAuthSession,
  type CurrentSessionView,
  getAuthRequestContext,
  type OAuthCallbackQuery,
  type OAuthTokenResponse,
  type OAuthUserInfo,
  type SessionUserView,
  setAuthRequestContext,
} from '../shared/types';
import { createPkceChallenge, createRandomToken, decryptValue, encryptValue, redactEmail } from '../shared/utils';
import { OAuthUserRepository, type OAuthUserRow, type OAuthUserUpsertInput } from '../users';
import { AuthCookieService } from './auth-cookie.service';
import { OAuthAuthProviderService } from './oauth-auth-provider.service';

function scopeToArray(scope: string | undefined, fallback: string[]): string[] {
  if (!scope) {
    return fallback;
  }

  return scope
    .split(/[,\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function coerceAudience(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }

  const values = coerceStringArray(value);
  return values.length > 0 ? values : undefined;
}

function toDateFromNow(seconds: number | undefined, fallbackSeconds: number): Date {
  const effectiveSeconds =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds;
  return new Date(Date.now() + effectiveSeconds * 1000);
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return getHeaderValue(value[0]);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const firstValue = value.split(',')[0]?.trim();

  return firstValue && firstValue.length > 0 ? firstValue : undefined;
}

type AccessDeniedReason = 'email_unverified' | 'not_allowlisted' | 'consent_denied';

@Injectable()
export class AuthService {
  private static readonly UNAUTHORIZED_MESSAGE = 'Authentication required.';
  private static readonly MOCK_SUB = 'did:deep-id:mock-preview-user';
  private static readonly MOCK_EMAIL = 'preview@reputo.local';
  private static readonly MOCK_USERNAME = 'preview-user';
  private readonly logger = new Logger(AuthService.name);
  private readonly tokenEncryptionKey: string;
  private readonly sessionTtlSeconds: number;
  private readonly refreshLeewaySeconds: number;
  private readonly authMode: string;
  private readonly appPublicUrl: string;
  private readonly refreshInFlight = new Map<string, Promise<AuthSessionWithSecrets | null>>();

  constructor(
    private readonly oauthAuthProviderService: OAuthAuthProviderService,
    private readonly authCookieService: AuthCookieService,
    private readonly authSessionRepository: AuthSessionRepository,
    private readonly oauthUserRepository: OAuthUserRepository,
    private readonly adminService: AdminService,
    configService: ConfigService,
  ) {
    this.tokenEncryptionKey = configService.get<string>('auth.tokenEncryptionKey') as string;
    this.sessionTtlSeconds = configService.get<number>('auth.sessionTtlSeconds') as number;
    this.refreshLeewaySeconds = configService.get<number>('auth.refreshLeewaySeconds') as number;
    this.authMode = (configService.get<string>('auth.mode') ?? AUTH_MODE_OAUTH).toLowerCase();
    this.appPublicUrl = configService.get<string>('auth.appPublicUrl') as string;
  }

  async getLoginRedirectUrl(provider: OAuthProvider, request: Request, response: Response): Promise<string> {
    if (this.authMode === AUTH_MODE_MOCK) {
      return this.createMockLoginRedirect(provider, request, response);
    }

    const authFlow = this.createAuthFlow(provider);
    const codeChallenge = createPkceChallenge(authFlow.codeVerifier);
    const redirectUrl = await this.oauthAuthProviderService.buildAuthorizationUrl(provider, authFlow, codeChallenge);

    this.authCookieService.setAuthFlowCookie(response, authFlow);

    return redirectUrl;
  }

  async handleCallback(
    provider: OAuthProvider,
    query: OAuthCallbackQuery,
    request: Request,
    response: Response,
  ): Promise<string> {
    if (this.authMode === AUTH_MODE_MOCK) {
      try {
        return await this.createMockLoginRedirect(provider, request, response);
      } finally {
        this.authCookieService.clearAuthFlowCookie(response);
      }
    }

    const authFlow = this.authCookieService.getAuthFlow(request);

    try {
      if (query.error) {
        // The provider signals user-initiated cancel with `access_denied` per
        // RFC 6749 §4.1.2.1. Treat that as a benign back-to-login instead of
        // surfacing a 401 JSON to the browser.
        if (query.error === 'access_denied') {
          return this.denyCallbackAccess('consent_denied', undefined, undefined);
        }
        throw new UnauthorizedException(query.error_description ?? `OAuth authorization failed: ${query.error}`);
      }

      if (!authFlow?.state || !authFlow.codeVerifier || !authFlow.provider) {
        throw new UnauthorizedException('OAuth auth flow context is missing.');
      }

      if (authFlow.provider !== provider) {
        throw new UnauthorizedException('OAuth auth provider mismatch.');
      }

      if (!query.state || query.state !== authFlow.state) {
        throw new UnauthorizedException('OAuth auth state mismatch.');
      }

      if (!query.code) {
        throw new UnauthorizedException('OAuth authorization code is missing.');
      }

      const tokenResponse = await this.oauthAuthProviderService.exchangeCodeForTokens(
        provider,
        query.code,
        authFlow.codeVerifier,
      );
      const userInfo = await this.oauthAuthProviderService.fetchUserInfo(provider, tokenResponse.access_token);
      const accessDeniedRedirectUrl = await this.getCallbackAccessDeniedRedirectUrl(provider, userInfo);

      if (accessDeniedRedirectUrl) {
        return accessDeniedRedirectUrl;
      }

      const user = await this.syncUserFromUserInfo(provider, userInfo);
      const session = await this.createApplicationSession(user, tokenResponse, authFlow);

      this.authCookieService.setSessionCookie(response, session.sessionId, session.expiresAt);

      return this.appPublicUrl;
    } finally {
      this.authCookieService.clearAuthFlowCookie(response);
    }
  }

  async requireSession(request: Request, response: Response): Promise<AuthRequestContext> {
    const existingContext = getAuthRequestContext(request);

    if (existingContext) {
      return existingContext;
    }

    const sessionId = this.authCookieService.getSessionId(request);

    if (!sessionId) {
      throw new UnauthorizedException(AuthService.UNAUTHORIZED_MESSAGE);
    }

    const session = await this.authSessionRepository.findActiveBySessionId(sessionId, true);

    if (!session) {
      this.authCookieService.clearSessionCookie(response);
      throw new UnauthorizedException(AuthService.UNAUTHORIZED_MESSAGE);
    }

    const activeSession: AuthSessionWithSecrets | null = await this.refreshSessionIfNeeded(session);

    if (!activeSession) {
      this.authCookieService.clearSessionCookie(response);
      throw new UnauthorizedException(AuthService.UNAUTHORIZED_MESSAGE);
    }

    const user = await this.oauthUserRepository.findById(activeSession.userId);

    if (!user) {
      await this.authSessionRepository.revokeBySessionId(activeSession.sessionId);
      this.authCookieService.clearSessionCookie(response);
      throw new UnauthorizedException(AuthService.UNAUTHORIZED_MESSAGE);
    }

    const role = await this.resolveSessionRole(activeSession.provider, user);

    if (!role) {
      await this.authSessionRepository.revokeBySessionId(activeSession.sessionId);
      this.authCookieService.clearSessionCookie(response);
      throw new UnauthorizedException(AuthService.UNAUTHORIZED_MESSAGE);
    }

    this.authCookieService.setSessionCookie(response, activeSession.sessionId, activeSession.expiresAt);

    return setAuthRequestContext(request, {
      role,
      session: this.toCurrentAuthSession(activeSession),
      user,
    });
  }

  async logout(session: CurrentAuthSession, response: Response): Promise<void> {
    await this.authSessionRepository.revokeBySessionId(session.sessionId);

    this.authCookieService.clearSessionCookie(response);
    this.authCookieService.clearAuthFlowCookie(response);
  }

  toCurrentSessionView(session: CurrentAuthSession, user: OAuthUserRow, role: AccessRole): CurrentSessionView {
    return {
      authenticated: true,
      provider: session.provider,
      role,
      expiresAt: session.expiresAt.toISOString(),
      scope: session.scope,
      user: this.toSessionUserView(user, role),
    };
  }

  private createAuthFlow(provider: OAuthProvider): AuthFlowState {
    return {
      provider,
      state: createRandomToken(24),
      codeVerifier: createRandomToken(32),
    };
  }

  private async createMockLoginRedirect(
    provider: OAuthProvider,
    request: Request,
    response: Response,
  ): Promise<string> {
    const user = await this.oauthUserRepository.upsertBySub(provider, AuthService.MOCK_SUB, {
      email: AuthService.MOCK_EMAIL,
      email_verified: true,
      username: AuthService.MOCK_USERNAME,
    });
    const session = await this.createMockApplicationSession(user, provider);

    this.authCookieService.setSessionCookie(response, session.sessionId, session.expiresAt);

    return this.resolveRequestOrigin(request);
  }

  private resolveRequestOrigin(request: Request): string {
    const protocol = getHeaderValue(request.headers['x-forwarded-proto']) ?? (request.secure ? 'https' : 'http');
    const host = getHeaderValue(request.headers['x-forwarded-host']) ?? getHeaderValue(request.headers.host);

    if (host) {
      return `${protocol}://${host}`;
    }

    return new URL(this.appPublicUrl).origin;
  }

  private async syncUserFromUserInfo(provider: OAuthProvider, userInfo: OAuthUserInfo): Promise<OAuthUserRow> {
    if (typeof userInfo.sub !== 'string' || userInfo.sub.trim().length === 0) {
      throw new BadGatewayException(
        `OAuth provider ${provider} userinfo response is missing a stable subject identifier.`,
      );
    }

    const update: OAuthUserUpsertInput = {
      aud: coerceAudience(userInfo.aud),
      auth_time:
        typeof userInfo.auth_time === 'number' && Number.isFinite(userInfo.auth_time) ? userInfo.auth_time : undefined,
      email: typeof userInfo.email === 'string' ? userInfo.email : undefined,
      email_verified: typeof userInfo.email_verified === 'boolean' ? userInfo.email_verified : undefined,
      iat: typeof userInfo.iat === 'number' && Number.isFinite(userInfo.iat) ? userInfo.iat : undefined,
      iss: typeof userInfo.iss === 'string' ? userInfo.iss : undefined,
      picture: typeof userInfo.picture === 'string' ? userInfo.picture : undefined,
      rat: typeof userInfo.rat === 'number' && Number.isFinite(userInfo.rat) ? userInfo.rat : undefined,
      username: typeof userInfo.username === 'string' ? userInfo.username : undefined,
    };

    return this.oauthUserRepository.upsertBySub(provider, userInfo.sub, update);
  }

  private async getCallbackAccessDeniedRedirectUrl(
    provider: OAuthProvider,
    userInfo: OAuthUserInfo,
  ): Promise<string | null> {
    const email = this.normalizeEmail(userInfo.email);
    const sub = typeof userInfo.sub === 'string' && userInfo.sub.trim().length > 0 ? userInfo.sub : undefined;

    if (!email || userInfo.email_verified !== true) {
      return this.denyCallbackAccess('email_unverified', email, sub);
    }

    const allowlistRow = await this.adminService.isAllowlisted(provider, email);

    if (!allowlistRow) {
      return this.denyCallbackAccess('not_allowlisted', email, sub);
    }

    return null;
  }

  private denyCallbackAccess(reason: AccessDeniedReason, email: string | undefined, sub: string | undefined): string {
    this.logger.warn({
      email: redactEmail(email),
      sub,
      reason,
    });

    return `${this.appPublicUrl.replace(/\/+$/u, '')}/access-denied?reason=${reason}`;
  }

  private normalizeEmail(email: unknown): string | undefined {
    if (typeof email !== 'string') {
      return undefined;
    }

    const normalizedEmail = email.trim().toLowerCase();

    return normalizedEmail.length > 0 ? normalizedEmail : undefined;
  }

  private async createApplicationSession(
    user: OAuthUserRow,
    tokenResponse: OAuthTokenResponse,
    authFlow: AuthFlowState,
  ): Promise<AuthSessionWithSecrets> {
    if (!tokenResponse.refresh_token) {
      throw new BadGatewayException(`OAuth provider ${authFlow.provider} token response is missing the refresh token.`);
    }

    const now = Date.now();
    const sessionAbsoluteExpiry = new Date(now + this.sessionTtlSeconds * 1000);
    const accessTokenExpiresAt = toDateFromNow(tokenResponse.expires_in, this.refreshLeewaySeconds);
    const refreshTokenExpiresAt = toDateFromNow(tokenResponse.refresh_token_expires_in, this.sessionTtlSeconds);
    const expiresAt =
      refreshTokenExpiresAt.getTime() < sessionAbsoluteExpiry.getTime() ? refreshTokenExpiresAt : sessionAbsoluteExpiry;

    return this.authSessionRepository.create({
      sessionId: createRandomToken(32),
      provider: authFlow.provider,
      userId: user._id,
      accessTokenCiphertext: encryptValue(this.tokenEncryptionKey, tokenResponse.access_token),
      refreshTokenCiphertext: encryptValue(this.tokenEncryptionKey, tokenResponse.refresh_token),
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      scope: scopeToArray(tokenResponse.scope, this.oauthAuthProviderService.getScopes(authFlow.provider)),
      state: authFlow.state,
      codeVerifier: authFlow.codeVerifier,
      expiresAt,
    });
  }

  private async createMockApplicationSession(
    user: OAuthUserRow,
    provider: OAuthProvider,
  ): Promise<AuthSessionWithSecrets> {
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000);

    return this.authSessionRepository.create({
      sessionId: createRandomToken(32),
      provider,
      userId: user._id,
      accessTokenCiphertext: encryptValue(this.tokenEncryptionKey, 'mock-access-token'),
      refreshTokenCiphertext: encryptValue(this.tokenEncryptionKey, 'mock-refresh-token'),
      accessTokenExpiresAt: expiresAt,
      refreshTokenExpiresAt: expiresAt,
      scope: this.oauthAuthProviderService.getScopes(provider),
      state: createRandomToken(24),
      codeVerifier: createRandomToken(32),
      expiresAt,
    });
  }

  private async refreshSessionIfNeeded(session: AuthSessionWithSecrets): Promise<AuthSessionWithSecrets | null> {
    const refreshThreshold = Date.now() + this.refreshLeewaySeconds * 1000;

    if (session.accessTokenExpiresAt.getTime() > refreshThreshold) {
      return session;
    }

    if (session.refreshTokenExpiresAt.getTime() <= Date.now()) {
      await this.authSessionRepository.revokeBySessionId(session.sessionId);
      return null;
    }

    // Coalesce concurrent refreshes for the same session within this process so
    // parallel requests don't replay a rotated refresh token and trip
    // invalid_grant on the loser.
    const existing = this.refreshInFlight.get(session.sessionId);
    if (existing) {
      return existing;
    }

    const pending = this.performRefresh(session).finally(() => {
      this.refreshInFlight.delete(session.sessionId);
    });
    this.refreshInFlight.set(session.sessionId, pending);
    return pending;
  }

  private async performRefresh(session: AuthSessionWithSecrets): Promise<AuthSessionWithSecrets | null> {
    try {
      const refreshToken = decryptValue(this.tokenEncryptionKey, session.refreshTokenCiphertext);
      const tokenResponse = await this.oauthAuthProviderService.refreshTokens(session.provider, refreshToken);
      const accessTokenExpiresAt = toDateFromNow(tokenResponse.expires_in, this.refreshLeewaySeconds);
      const nextRefreshToken = tokenResponse.refresh_token
        ? encryptValue(this.tokenEncryptionKey, tokenResponse.refresh_token)
        : session.refreshTokenCiphertext;
      const nextRefreshTokenExpiresAt =
        typeof tokenResponse.refresh_token_expires_in === 'number'
          ? toDateFromNow(tokenResponse.refresh_token_expires_in, this.sessionTtlSeconds)
          : session.refreshTokenExpiresAt;
      const expiresAt =
        nextRefreshTokenExpiresAt.getTime() < session.expiresAt.getTime()
          ? nextRefreshTokenExpiresAt
          : session.expiresAt;

      const updatedSession = await this.authSessionRepository.updateAfterRefresh(session.sessionId, {
        accessTokenCiphertext: encryptValue(this.tokenEncryptionKey, tokenResponse.access_token),
        refreshTokenCiphertext: nextRefreshToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt: nextRefreshTokenExpiresAt,
        scope: scopeToArray(tokenResponse.scope, session.scope),
        lastRefreshedAt: new Date(),
        expiresAt,
      });

      if (!updatedSession) {
        return null;
      }

      try {
        const userInfo = await this.oauthAuthProviderService.fetchUserInfo(
          session.provider,
          tokenResponse.access_token,
        );
        await this.syncUserFromUserInfo(session.provider, userInfo);
      } catch {
        // Preserve session viability even if profile refresh is temporarily unavailable.
      }

      return {
        ...updatedSession,
        refreshTokenCiphertext: nextRefreshToken,
      };
    } catch (error) {
      return this.handleRefreshFailure(session, error);
    }
  }

  private async handleRefreshFailure(
    session: AuthSessionWithSecrets,
    error: unknown,
  ): Promise<AuthSessionWithSecrets | null> {
    // Only treat provider-rejection errors (invalid_grant / invalid_token) as
    // terminal — those mean the stored refresh token will never work again.
    // Everything else (network blips, 5xx, malformed responses) is transient
    // and must not log the user out.
    if (!(error instanceof UnauthorizedException)) {
      this.logger.warn({
        sessionId: session.sessionId,
        provider: session.provider,
        err: error instanceof Error ? error.message : String(error),
        msg: 'Transient refresh failure; preserving session for retry.',
      });
      return session;
    }

    // A peer instance (or this one after a restart) may have already rotated
    // the refresh token. If the persisted session was refreshed after our
    // in-memory snapshot, adopt the latest copy instead of revoking.
    const latest = await this.authSessionRepository.findActiveBySessionId(session.sessionId, true);
    const latestRefreshedAt = latest?.lastRefreshedAt?.getTime() ?? 0;
    const ourRefreshedAt = session.lastRefreshedAt?.getTime() ?? 0;

    if (latest && latestRefreshedAt > ourRefreshedAt) {
      return latest;
    }

    await this.authSessionRepository.revokeBySessionId(session.sessionId);
    return null;
  }

  private async resolveSessionRole(provider: OAuthProvider, user: OAuthUserRow): Promise<AccessRole | null> {
    if (this.authMode === AUTH_MODE_MOCK) {
      return ACCESS_ROLE_OWNER;
    }

    if (!user.email) {
      return null;
    }

    return this.adminService.resolveRole(provider, user.email);
  }

  private toCurrentAuthSession(session: AuthSessionWithSecrets): CurrentAuthSession {
    const {
      accessTokenCiphertext: _accessTokenCiphertext,
      refreshTokenCiphertext: _refreshTokenCiphertext,
      state: _state,
      codeVerifier: _codeVerifier,
      ...currentSession
    } = session;

    return currentSession;
  }

  private toSessionUserView(user: OAuthUserRow, role: AccessRole): SessionUserView {
    return {
      id: user._id,
      provider: user.provider,
      role,
      sub: user.sub,
      aud: user.aud,
      auth_time: user.auth_time,
      email: user.email,
      email_verified: user.email_verified,
      iat: user.iat,
      iss: user.iss,
      picture: user.picture,
      rat: user.rat,
      username: user.username,
      createdAt: user.createdAt?.toISOString(),
      updatedAt: user.updatedAt?.toISOString(),
    };
  }
}

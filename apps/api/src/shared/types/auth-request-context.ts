import type { AccessRole, AuthSessionWithId, OAuthUserWithId } from '@reputo/database';
import type { Request } from 'express';

type AuthSessionRequestHiddenFields = 'accessTokenCiphertext' | 'refreshTokenCiphertext' | 'state' | 'codeVerifier';

export type CurrentAuthSession = Omit<AuthSessionWithId, AuthSessionRequestHiddenFields>;

export interface AuthRequestContext {
  role: AccessRole;
  session: CurrentAuthSession;
  user: OAuthUserWithId;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthRequestContext;
    }
  }
}

export function getAuthRequestContext(request: Request): AuthRequestContext | undefined {
  return request.authContext;
}

export function setAuthRequestContext(request: Request, context: AuthRequestContext): AuthRequestContext {
  request.authContext = context;
  return context;
}

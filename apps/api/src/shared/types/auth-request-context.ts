import type { AccessRole } from '@reputo/database';
import type { Request } from 'express';
import type { AuthSessionRow } from '../../sessions';
import type { OAuthUserRow } from '../../users';

// Public AuthSessionRow already excludes ciphertexts, PKCE verifier, and
// the CSRF state, so consumers of `request.authContext` cannot accidentally
// log secret material.
export type CurrentAuthSession = AuthSessionRow;

export interface AuthRequestContext {
  role: AccessRole;
  session: CurrentAuthSession;
  user: OAuthUserRow;
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

import type { AccessRole } from '@reputo/contracts';
import type { Request } from 'express';
import type { AuthSessionRow } from '../../sessions';
import type { OAuthUserRow } from '../../users';

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

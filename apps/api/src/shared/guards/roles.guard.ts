import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessRole } from '@reputo/database';
import type { Request } from 'express';
import { IS_ROLES_ROUTE } from '../decorators/roles.decorator';
import { getAuthRequestContext } from '../types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<'http'>() !== 'http') {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<AccessRole[] | undefined>(IS_ROLES_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authContext = getAuthRequestContext(request);

    if (!authContext) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (!requiredRoles.includes(authContext.role)) {
      throw new ForbiddenException('Required role is missing.');
    }

    return true;
  }
}

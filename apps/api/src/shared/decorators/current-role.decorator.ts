import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { getAuthRequestContext } from '../types';

export const CurrentRole = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  const authContext = getAuthRequestContext(request);

  if (!authContext) {
    throw new UnauthorizedException('Authentication required.');
  }

  return authContext.role;
});

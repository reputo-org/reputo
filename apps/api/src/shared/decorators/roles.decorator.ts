import { SetMetadata } from '@nestjs/common';
import type { AccessRole } from '@reputo/contracts';

export const IS_ROLES_ROUTE = 'auth:roles';

export const Roles = (...roles: AccessRole[]) => SetMetadata(IS_ROLES_ROUTE, roles);

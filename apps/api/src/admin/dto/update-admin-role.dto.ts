import { ApiProperty } from '@nestjs/swagger';
import { ACCESS_ROLES, type AccessRole } from '@reputo/contracts';
import { IsIn } from 'class-validator';

export class UpdateAdminRoleDto {
  @ApiProperty({
    description: 'New access role.',
    enum: ACCESS_ROLES,
  })
  @IsIn(ACCESS_ROLES as unknown as string[])
  role: AccessRole;
}

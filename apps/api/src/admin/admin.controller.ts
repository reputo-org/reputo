import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_ROLE_ADMIN, ACCESS_ROLE_OWNER, OAUTH_PROVIDERS, type OAuthProvider } from '@reputo/contracts';
import { CurrentUser, Roles } from '../shared/decorators';
import { RolesGuard } from '../shared/guards/roles.guard';
import type { OAuthUserRow } from '../users';
import { AdminService } from './admin.service';
import { AdminListResponseDto, AdminViewDto, CreateAdminDto, ListAdminsQueryDto, UpdateAdminRoleDto } from './dto';

@ApiTags('Admins')
@ApiUnauthorizedResponse({ description: 'Authenticated session required.' })
@UseGuards(RolesGuard)
@Controller('admins')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @Roles(ACCESS_ROLE_OWNER, ACCESS_ROLE_ADMIN)
  @ApiOperation({
    summary: 'List allowlist rows with filters and pagination',
    description:
      'Returns a paginated, filterable view of allowlist rows. Defaults to active rows sorted by email ascending.',
  })
  @ApiOkResponse({ description: 'Allowlist rows.', type: AdminListResponseDto })
  @ApiForbiddenResponse({ description: 'Admin or owner role required.' })
  list(@Query() query: ListAdminsQueryDto): Promise<AdminListResponseDto> {
    return this.adminService.list(query);
  }

  @Post()
  @Roles(ACCESS_ROLE_OWNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an allowlist row',
    description:
      'Creates a new active allowlist row. Use POST /admins/{provider}/{email}/restore to revive revoked rows.',
  })
  @ApiBody({ type: CreateAdminDto })
  @ApiCreatedResponse({ description: 'Allowlist row created.', type: AdminViewDto })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiForbiddenResponse({ description: 'Owner role required.' })
  @ApiConflictResponse({ description: 'An allowlist row already exists for this provider and email.' })
  add(@CurrentUser() actor: OAuthUserRow, @Body() body: CreateAdminDto): Promise<AdminViewDto> {
    return this.adminService.addAdmin(actor, body);
  }

  @Patch(':provider/:email')
  @Roles(ACCESS_ROLE_OWNER)
  @ApiOperation({
    summary: 'Update an allowlist row role',
    description: 'Promotes or demotes an active allowlist row. Cannot demote yourself or the last active owner.',
  })
  @ApiParam({ name: 'provider', enum: OAUTH_PROVIDERS })
  @ApiParam({ name: 'email', description: 'Email address of the active allowlist row.' })
  @ApiBody({ type: UpdateAdminRoleDto })
  @ApiOkResponse({ description: 'Allowlist row updated.', type: AdminViewDto })
  @ApiBadRequestResponse({ description: 'Invalid path parameter or body.' })
  @ApiForbiddenResponse({ description: 'Owner role required, or rule blocked the change.' })
  @ApiNotFoundResponse({ description: 'No active allowlist row exists for this provider and email.' })
  updateRole(
    @CurrentUser() actor: OAuthUserRow,
    @Param('provider') provider: string,
    @Param('email') email: string,
    @Body() body: UpdateAdminRoleDto,
  ): Promise<AdminViewDto> {
    return this.adminService.updateRole(actor, {
      provider: this.parseProvider(provider),
      email,
      role: body.role,
    });
  }

  @Post(':provider/:email/restore')
  @Roles(ACCESS_ROLE_OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore a revoked allowlist row',
    description: 'Revives a previously revoked allowlist row as an admin (role can then be promoted via PATCH).',
  })
  @ApiParam({ name: 'provider', enum: OAUTH_PROVIDERS })
  @ApiParam({ name: 'email', description: 'Email address of the revoked allowlist row.' })
  @ApiOkResponse({ description: 'Allowlist row restored.', type: AdminViewDto })
  @ApiBadRequestResponse({ description: 'Invalid path parameter.' })
  @ApiForbiddenResponse({ description: 'Owner role required.' })
  @ApiNotFoundResponse({ description: 'No revoked allowlist row exists for this provider and email.' })
  restore(
    @CurrentUser() actor: OAuthUserRow,
    @Param('provider') provider: string,
    @Param('email') email: string,
  ): Promise<AdminViewDto> {
    return this.adminService.restoreAdmin(actor, {
      provider: this.parseProvider(provider),
      email,
    });
  }

  @Delete(':provider/:email')
  @Roles(ACCESS_ROLE_OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an allowlist row',
    description: 'Soft-revokes the active allowlist row and revokes all active sessions for the matching user.',
  })
  @ApiParam({ name: 'provider', enum: OAUTH_PROVIDERS })
  @ApiParam({ name: 'email', description: 'Email address of the active allowlist row.' })
  @ApiNoContentResponse({ description: 'Allowlist row revoked and active sessions invalidated.' })
  @ApiBadRequestResponse({ description: 'Invalid path parameter.' })
  @ApiForbiddenResponse({ description: 'Owner role required, or rule blocked the change.' })
  @ApiNotFoundResponse({ description: 'No active allowlist row exists for this provider and email.' })
  remove(
    @CurrentUser() actor: OAuthUserRow,
    @Param('provider') provider: string,
    @Param('email') email: string,
  ): Promise<void> {
    return this.adminService.removeAdmin(actor, {
      provider: this.parseProvider(provider),
      email,
    });
  }

  private parseProvider(value: string): OAuthProvider {
    const candidate = value?.toLowerCase();
    if (!candidate || !(OAUTH_PROVIDERS as readonly string[]).includes(candidate)) {
      throw new BadRequestException(`Unknown provider: ${value}`);
    }
    return candidate as OAuthProvider;
  }
}

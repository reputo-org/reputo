import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_ROLE_ADMIN, ACCESS_ROLE_OWNER } from '@reputo/contracts';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../shared/decorators';
import { RolesGuard } from '../shared/guards/roles.guard';
import type { OAuthUserRow } from '../users';
import { CommunityService } from './community.service';
import {
  CommunityConnectionDto,
  CommunityHealthDto,
  CommunityInstallUrlDto,
  CommunityResourceDto,
  DiscordCallbackQueryDto,
  DiscordInstallUrlQueryDto,
} from './dto';

@ApiTags('Community Connections')
@ApiUnauthorizedResponse({ description: 'Authenticated session required.' })
@ApiForbiddenResponse({ description: 'Admin or owner role required.' })
@UseGuards(RolesGuard)
@Roles(ACCESS_ROLE_OWNER, ACCESS_ROLE_ADMIN)
@Controller('community/connections')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get()
  @ApiOperation({
    summary: 'List community connections',
    description: 'Returns every community connection with its lifecycle state. Credentials are never included.',
  })
  @ApiOkResponse({ description: 'Community connections.', type: [CommunityConnectionDto] })
  list(): Promise<CommunityConnectionDto[]> {
    return this.communityService.list();
  }

  @Get('discord/install-url')
  @ApiOperation({
    summary: 'Start a Discord connect flow',
    description:
      'Returns the Discord bot install URL, carrying a signed install state that expires. ' +
      'The bot asks for View Channels and Read Message History only.',
  })
  @ApiQuery({
    name: 'connectionId',
    required: false,
    description:
      'Reconnect an existing connection. The authorization screen is locked to that community, so the admin cannot land on a different server.',
  })
  @ApiOkResponse({ description: 'Install URL.', type: CommunityInstallUrlDto })
  @ApiBadRequestResponse({ description: 'Invalid ID format, or the connection is not a Discord connection.' })
  @ApiNotFoundResponse({ description: 'Connection not found.' })
  getDiscordInstallUrl(
    @CurrentUser() actor: OAuthUserRow,
    @Query() query: DiscordInstallUrlQueryDto,
  ): Promise<CommunityInstallUrlDto> {
    return this.communityService.getDiscordInstallUrl(actor, query.connectionId);
  }

  @Get('discord/callback')
  @ApiOperation({
    summary: 'Complete a Discord connect flow',
    description:
      'Verifies the install state, exchanges the code, probes the guild, and redirects the browser back to the UI. ' +
      'A failed connect redirects with a safe error category rather than an error page.',
  })
  @ApiFoundResponse({ description: 'Redirects the browser back to the community page.' })
  @ApiBadRequestResponse({ description: 'Callback query failed validation.' })
  async handleDiscordCallback(
    @CurrentUser() actor: OAuthUserRow,
    @Query() query: DiscordCallbackQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.redirect(await this.communityService.handleDiscordCallback(actor, query));
  }

  @Get(':id/resources')
  @ApiOperation({
    summary: 'List the resources of a connection',
    description: 'Text, announcement, and forum channels a preset can select. No message content is read.',
  })
  @ApiParam({ name: 'id', description: 'Connection identifier.', example: '01940000-0000-7000-8000-000000000000' })
  @ApiOkResponse({ description: 'Selectable resources.', type: [CommunityResourceDto] })
  @ApiBadRequestResponse({ description: 'Invalid ID format.' })
  @ApiNotFoundResponse({ description: 'Connection not found.' })
  @ApiConflictResponse({ description: 'Connection is disconnected.' })
  @ApiBadGatewayResponse({ description: 'The platform refused or failed the call; the connection state is updated.' })
  listResources(
    @CurrentUser() actor: OAuthUserRow,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<CommunityResourceDto[]> {
    return this.communityService.listResources(actor, id);
  }

  @Get(':id/health')
  @ApiOperation({
    summary: 'Re-check a connection',
    description:
      'Runs the capability probe on demand and stores the resulting state. ' +
      'A failed probe is reported in the response, not raised as an error.',
  })
  @ApiParam({ name: 'id', description: 'Connection identifier.', example: '01940000-0000-7000-8000-000000000000' })
  @ApiOkResponse({ description: 'Probe result and the resulting state.', type: CommunityHealthDto })
  @ApiBadRequestResponse({ description: 'Invalid ID format.' })
  @ApiNotFoundResponse({ description: 'Connection not found.' })
  @ApiConflictResponse({ description: 'Connection is disconnected.' })
  checkHealth(
    @CurrentUser() actor: OAuthUserRow,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<CommunityHealthDto> {
    return this.communityService.checkHealth(actor, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disconnect a community',
    description:
      'Removes the bot from the community, then deletes the connection. The audit history is kept. ' +
      'If the bot cannot be removed the connection is left in place so the admin can retry.',
  })
  @ApiParam({ name: 'id', description: 'Connection identifier.', example: '01940000-0000-7000-8000-000000000000' })
  @ApiNoContentResponse({ description: 'Bot removed and connection deleted.' })
  @ApiBadRequestResponse({ description: 'Invalid ID format.' })
  @ApiNotFoundResponse({ description: 'Connection not found.' })
  @ApiBadGatewayResponse({ description: 'The bot could not be removed; the connection was kept.' })
  disconnect(
    @CurrentUser() actor: OAuthUserRow,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.communityService.disconnect(actor, id);
  }
}

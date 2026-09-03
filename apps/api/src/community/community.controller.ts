import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  type MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { map, type Observable } from 'rxjs';
import { COMMUNITY_CONNECTIONS_ROUTE, GITHUB_CALLBACK_ROUTE } from '../shared/constants';
import { CurrentUser, Roles } from '../shared/decorators';
import { RolesGuard } from '../shared/guards/roles.guard';
import type { OAuthUserRow } from '../users';
import { CommunityService } from './community.service';
import { CommunityEventsService } from './community-events.service';
import {
  CommunityConnectionDto,
  CommunityConnectionEventDto,
  CommunityHealthDto,
  CommunityInstallUrlDto,
  CommunityInstallUrlQueryDto,
  CommunityResourceDto,
  DiscordCallbackQueryDto,
  GitHubCallbackQueryDto,
  MattermostConnectRequestDto,
  MattermostValidateRequestDto,
  MattermostValidationDto,
} from './dto';

@ApiTags('Community Connections')
@ApiUnauthorizedResponse({ description: 'Authenticated session required.' })
@ApiForbiddenResponse({ description: 'Admin or owner role required.' })
@UseGuards(RolesGuard)
@Roles(ACCESS_ROLE_OWNER, ACCESS_ROLE_ADMIN)
@Controller(COMMUNITY_CONNECTIONS_ROUTE)
export class CommunityController {
  constructor(
    private readonly communityService: CommunityService,
    private readonly events: CommunityEventsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List community connections',
    description: 'Returns every community connection with its lifecycle state. Credentials are never included.',
  })
  @ApiOkResponse({ description: 'Community connections.', type: [CommunityConnectionDto] })
  list(): Promise<CommunityConnectionDto[]> {
    return this.communityService.list();
  }

  @Sse('events')
  @ApiOperation({
    summary: 'Follow connection changes via SSE',
    description:
      'Opens a Server-Sent Events stream of connection changes: status, reason, metadata, name, and removals. ' +
      'While at least one client is subscribed the API re-probes every connection on its watch cadence, ' +
      'announced by the first event of the stream.',
  })
  @ApiOkResponse({ description: 'SSE stream established.', type: CommunityConnectionEventDto })
  subscribeToEvents(): Observable<MessageEvent> {
    return this.events.subscribe().pipe(map((event) => ({ data: event })));
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
    @Query() query: CommunityInstallUrlQueryDto,
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

  @Get('github/install-url')
  @ApiOperation({
    summary: 'Start a GitHub connect flow',
    description:
      'Returns the GitHub App install URL, carrying a signed install state that expires. ' +
      'The App asks for read-only access to issues, pull requests, and metadata.',
  })
  @ApiQuery({
    name: 'connectionId',
    required: false,
    description:
      'Reconnect an existing connection. GitHub picks the account on its own screen, so the install is idempotent per account rather than locked to one installation.',
  })
  @ApiOkResponse({ description: 'Install URL.', type: CommunityInstallUrlDto })
  @ApiBadRequestResponse({ description: 'Invalid ID format, or the connection is not a GitHub connection.' })
  @ApiNotFoundResponse({ description: 'Connection not found.' })
  getGitHubInstallUrl(
    @CurrentUser() actor: OAuthUserRow,
    @Query() query: CommunityInstallUrlQueryDto,
  ): Promise<CommunityInstallUrlDto> {
    return this.communityService.getGitHubInstallUrl(actor, query.connectionId);
  }

  @Get(GITHUB_CALLBACK_ROUTE)
  @ApiOperation({
    summary: 'Complete a GitHub connect flow',
    description:
      "The App's setup URL. Verifies the install state, confirms the installation with the app JWT, probes it, " +
      'and redirects the browser back to the UI. A failed connect redirects with a safe error category.',
  })
  @ApiFoundResponse({ description: 'Redirects the browser back to the community page.' })
  @ApiBadRequestResponse({ description: 'Callback query failed validation.' })
  async handleGitHubCallback(
    @CurrentUser() actor: OAuthUserRow,
    @Query() query: GitHubCallbackQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.redirect(await this.communityService.handleGitHubCallback(actor, query));
  }

  @Post('mattermost/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a Mattermost server and token',
    description:
      "Verifies the pasted server URL and bot token against the server and returns the token's teams. " +
      'Nothing is stored, the token is never echoed back, and the URL must pass the outbound network policy.',
  })
  @ApiOkResponse({ description: 'Token verified; teams to pick from.', type: MattermostValidationDto })
  @ApiBadRequestResponse({
    description: 'The URL is blocked by the outbound policy or the server rejected the token. Carries a reason code.',
  })
  @ApiBadGatewayResponse({ description: 'The server could not be reached or answered with an error.' })
  validateMattermost(
    @CurrentUser() actor: OAuthUserRow,
    @Body() body: MattermostValidateRequestDto,
  ): Promise<MattermostValidationDto> {
    return this.communityService.validateMattermost(actor, body);
  }

  @Post('mattermost/connect')
  @ApiOperation({
    summary: 'Connect a Mattermost team',
    description:
      'Validates the token again, seals it at rest bound to the connection, saves the connection, and probes it. ' +
      'The connection is keyed by origin and team, so http:// and https:// on the same host never collide.',
  })
  @ApiCreatedResponse({ description: 'Connection saved; state reflects the probe.', type: CommunityConnectionDto })
  @ApiBadRequestResponse({
    description: 'Blocked URL, rejected token, or a team the token does not belong to. Carries a reason code.',
  })
  @ApiBadGatewayResponse({ description: 'The server could not be reached or answered with an error.' })
  connectMattermost(
    @CurrentUser() actor: OAuthUserRow,
    @Body() body: MattermostConnectRequestDto,
  ): Promise<CommunityConnectionDto> {
    return this.communityService.connectMattermost(actor, body);
  }

  @Get(':id/resources')
  @ApiOperation({
    summary: 'List the resources of a connection',
    description:
      'Resources a preset can select — Discord channels, GitHub repositories. No message or issue content is read.',
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
      "Revokes Reputo's access on the platform, then deletes the connection. The audit history is kept. " +
      'If access cannot be revoked the connection is left in place so the admin can retry.',
  })
  @ApiParam({ name: 'id', description: 'Connection identifier.', example: '01940000-0000-7000-8000-000000000000' })
  @ApiNoContentResponse({ description: 'Access revoked and connection deleted.' })
  @ApiBadRequestResponse({ description: 'Invalid ID format.' })
  @ApiNotFoundResponse({ description: 'Connection not found.' })
  @ApiBadGatewayResponse({ description: 'Access could not be revoked; the connection was kept.' })
  disconnect(
    @CurrentUser() actor: OAuthUserRow,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.communityService.disconnect(actor, id);
  }
}

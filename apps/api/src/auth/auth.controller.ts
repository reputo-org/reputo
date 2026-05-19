import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AccessRole, OAuthProvider, OAuthUserWithId } from '@reputo/database';
import type { Request, Response } from 'express';
import { CurrentRole, CurrentSession, CurrentUser, Public } from '../shared/decorators';
import type { CurrentAuthSession, OAuthCallbackQuery } from '../shared/types';
import { AuthService } from './auth.service';
import { CurrentSessionDto } from './dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get(':provider/login')
  @Public()
  @ApiOperation({
    summary: 'Start an OAuth login flow',
    description: 'Creates transient PKCE auth flow state and redirects the browser to the selected OAuth provider.',
  })
  @ApiParam({ name: 'provider', example: 'deep-id' })
  @ApiFoundResponse({ description: 'Redirects the browser to the selected OAuth provider.' })
  async login(
    @Param('provider') provider: OAuthProvider,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const redirectUrl = await this.authService.getLoginRedirectUrl(provider, request, response);
    response.redirect(redirectUrl);
  }

  @Get(':provider/callback')
  @Public()
  @ApiOperation({
    summary: 'Handle an OAuth login callback',
    description:
      'Exchanges the authorization code, syncs userinfo, creates the opaque app session, and redirects back to the app.',
  })
  @ApiParam({ name: 'provider', example: 'deep-id' })
  @ApiQuery({ name: 'code', required: false, type: String })
  @ApiQuery({ name: 'state', required: false, type: String })
  @ApiQuery({ name: 'error', required: false, type: String })
  @ApiQuery({ name: 'error_description', required: false, type: String })
  @ApiFoundResponse({ description: 'Redirects the browser back to the public app URL.' })
  @ApiUnauthorizedResponse({ description: 'State validation, authorization code exchange, or userinfo sync failed.' })
  async callback(
    @Param('provider') provider: OAuthProvider,
    @Query() query: OAuthCallbackQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const redirectUrl = await this.authService.handleCallback(provider, query, request, response);
    response.redirect(redirectUrl);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get the current application session',
    description:
      'Reads the opaque auth cookie, refreshes provider tokens when needed, and returns the current session state.',
  })
  @ApiOkResponse({
    description: 'Returns the current auth session bootstrap payload.',
    type: CurrentSessionDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authenticated session required.' })
  me(
    @CurrentSession() session: CurrentAuthSession,
    @CurrentUser() user: OAuthUserWithId,
    @CurrentRole() role: AccessRole,
  ) {
    return this.authService.toCurrentSessionView(session, user, role);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Logout the current application session',
    description: 'Revokes the current opaque application session and clears the auth cookies.',
  })
  @ApiNoContentResponse({ description: 'Auth session invalidated and cookie cleared.' })
  @ApiUnauthorizedResponse({ description: 'Authenticated session required.' })
  logout(@CurrentSession() session: CurrentAuthSession, @Res({ passthrough: true }) response: Response) {
    return this.authService.logout(session, response);
  }
}

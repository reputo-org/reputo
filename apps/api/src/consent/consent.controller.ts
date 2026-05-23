import { Controller, Get, HttpStatus, Param, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { OAuthProvider } from '@reputo/contracts';
import type { Response } from 'express';
import { CONSENT_INVALID_STATE_HTML } from '../shared/constants';
import { Public } from '../shared/decorators';
import { ConsentService, InvalidConsentStateException } from './consent.service';
import { ConsentCallbackQueryDto, ConsentInitiateQueryDto } from './dto';

@ApiTags('OAuth Consent')
@Controller('oauth/consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get(':provider')
  @Public()
  @ApiOperation({
    summary: 'Start an OAuth consent flow',
    description: 'Creates transient PKCE state for the configured source and redirects the browser to the provider.',
  })
  @ApiParam({ name: 'provider', example: 'deep-id' })
  @ApiQuery({ name: 'source', required: true, type: String, example: 'voting-portal' })
  @ApiFoundResponse({ description: 'Redirects the browser to the selected OAuth provider.' })
  @ApiBadRequestResponse({ description: 'Missing or unknown source.' })
  async initiate(
    @Param('provider') provider: OAuthProvider,
    @Query() query: ConsentInitiateQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const redirectUrl = await this.consentService.initiate(provider, query.source);
    response.redirect(redirectUrl);
  }

  @Get(':provider/callback')
  @Public()
  @ApiOperation({
    summary: 'Handle an OAuth consent callback',
    description:
      'Consumes transient consent state, exchanges the authorization code, discards tokens, and redirects back to the source.',
  })
  @ApiParam({ name: 'provider', example: 'deep-id' })
  @ApiQuery({ name: 'code', required: false, type: String })
  @ApiQuery({ name: 'state', required: false, type: String })
  @ApiQuery({ name: 'error', required: false, type: String })
  @ApiQuery({ name: 'error_description', required: false, type: String })
  @ApiQuery({ name: 'scope', required: false, type: String })
  @ApiFoundResponse({ description: 'Redirects the browser back to the configured source return URL.' })
  @ApiBadRequestResponse({ description: 'Invalid, expired, or replayed consent state.' })
  @ApiUnauthorizedResponse({ description: 'Not used by this public endpoint.' })
  async callback(
    @Param('provider') provider: OAuthProvider,
    @Query() query: ConsentCallbackQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const redirectUrl = await this.consentService.handleCallback(provider, query);
      response.redirect(redirectUrl);
    } catch (error) {
      if (error instanceof InvalidConsentStateException) {
        response.status(HttpStatus.BAD_REQUEST).type('html').send(CONSENT_INVALID_STATE_HTML);
        return;
      }

      throw error;
    }
  }
}

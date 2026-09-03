import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  GITHUB_DELIVERY_HEADER,
  GITHUB_EVENT_HEADER,
  GITHUB_SIGNATURE_HEADER,
  verifyGitHubWebhookSignature,
} from '@reputo/community-api';
import type { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { COMMUNITY_WEBHOOKS_ROUTE, GITHUB_WEBHOOK_ROUTE } from '../../shared/constants';
import { Public } from '../../shared/decorators';
import { CommunityWebhookRejectedException } from '../community.exceptions';
import { CommunityRealtimeService } from './community-realtime.service';

/** A delivery body larger than this is not a GitHub App event; refuse it unread. */
const MAX_DELIVERY_BYTES = 5 * 1024 * 1024;

/**
 * Where GitHub delivers its App webhooks. This is the one community route that
 * is not behind a session: GitHub is the caller, and it authenticates by
 * signing every delivery.
 *
 * Authentication is the HMAC over the exact bytes GitHub sent, so the route
 * reads `rawBody` rather than the parsed body — re-serializing JSON changes
 * byte order and the signature would never match. Nothing else about the
 * request is trusted, and no field of the payload is used beyond the
 * installation id and the action.
 *
 * The response is `202` as soon as the signature checks out: GitHub does not
 * retry a failed delivery, and its delivery timeout is short, so the re-probe
 * the delivery triggers must not happen on this request.
 */
@ApiTags('Community Connections')
@Public()
@Controller(COMMUNITY_WEBHOOKS_ROUTE)
export class CommunityWebhooksController {
  private readonly secret?: string;

  constructor(
    @InjectPinoLogger(CommunityWebhooksController.name)
    private readonly logger: PinoLogger,
    private readonly realtime: CommunityRealtimeService,
    configService: ConfigService,
  ) {
    this.secret = configService.get<string>('community.realtime.githubWebhookSecret');
  }

  @Post(GITHUB_WEBHOOK_ROUTE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Receive a GitHub App webhook delivery',
    description:
      'Called by GitHub, not by a client. Every delivery is authenticated by its HMAC signature over the raw body; ' +
      'an accepted delivery schedules a re-probe of the installation it names.',
  })
  @ApiHeader({ name: GITHUB_SIGNATURE_HEADER, description: 'HMAC-SHA256 of the raw body, keyed by the App secret.' })
  @ApiBody({ description: 'GitHub App event payload.', schema: { type: 'object' } })
  @ApiAcceptedResponse({ description: 'Signature verified; the delivery is being processed.' })
  @ApiUnauthorizedResponse({ description: 'Missing, malformed, or wrong signature.' })
  receiveGitHubDelivery(@Req() request: Request): void {
    const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
    const signature = header(request, GITHUB_SIGNATURE_HEADER);
    const event = header(request, GITHUB_EVENT_HEADER) ?? '';
    const delivery = header(request, GITHUB_DELIVERY_HEADER);

    if (this.secret === undefined) {
      this.logger.warn({ delivery, event }, 'Refused a GitHub delivery: no webhook secret is configured');
      throw new CommunityWebhookRejectedException();
    }
    if (!rawBody || rawBody.byteLength === 0 || rawBody.byteLength > MAX_DELIVERY_BYTES) {
      this.logger.warn({ delivery, event }, 'Refused a GitHub delivery with no readable body');
      throw new CommunityWebhookRejectedException();
    }
    if (!verifyGitHubWebhookSignature(this.secret, rawBody, signature)) {
      // Either a forged delivery or a secret that no longer matches the App.
      this.logger.warn({ delivery, event }, 'Refused a GitHub delivery whose signature did not verify');
      throw new CommunityWebhookRejectedException();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.warn({ delivery, event }, 'Refused a signed GitHub delivery that is not JSON');
      throw new CommunityWebhookRejectedException();
    }

    // Deliberately not awaited: the probe it schedules takes platform round
    // trips, and GitHub's delivery timeout is far shorter than that.
    void this.realtime.ingestGitHubDelivery(event, payload).catch((error: Error) => {
      this.logger.error({ err: error, delivery, event }, 'Handling a GitHub delivery failed');
    });
  }
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotImplementedException,
} from '@nestjs/common';
import { CommunityErrorCategory } from '@reputo/community-api';
import type { CommunityPlatform } from '@reputo/contracts';

/** Raised when an operation needs a connection that an admin has disconnected. */
export class CommunityConnectionDisconnectedException extends ConflictException {
  constructor() {
    super('This connection is disconnected. Connect the community again to use it.');
  }
}

/** Raised when the platform itself refused or failed the call. Carries a safe reason only. */
export class CommunityPlatformException extends BadGatewayException {}

/** Raised when a connection names a platform whose connect flow has not shipped yet. */
export class CommunityPlatformUnsupportedException extends NotImplementedException {
  constructor(platform: CommunityPlatform) {
    super(`Reputo cannot reach ${platform} communities yet.`);
  }
}

/** Raised when a platform-specific route is handed a connection of another platform. */
export class CommunityPlatformMismatchException extends BadRequestException {
  constructor(expected: CommunityPlatform, actual: CommunityPlatform) {
    super(`This route handles ${expected} connections, but that connection is ${actual}.`);
  }
}

/** Failures the admin cannot fix by changing their input. */
const UPSTREAM_CONNECT_CATEGORIES = new Set<string>([
  CommunityErrorCategory.rateLimited,
  CommunityErrorCategory.networkError,
  CommunityErrorCategory.upstreamError,
]);

/**
 * Raised when a Mattermost validate or connect attempt fails. The body carries
 * the safe category as a machine-readable reason code — the dialog maps it to
 * prose — and never an upstream response.
 */
export class CommunityMattermostConnectException extends HttpException {
  constructor(readonly category: string) {
    super(category, UPSTREAM_CONNECT_CATEGORIES.has(category) ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST);
  }
}

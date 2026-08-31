import { BadGatewayException, BadRequestException, ConflictException, NotImplementedException } from '@nestjs/common';
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

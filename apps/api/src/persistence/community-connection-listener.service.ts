import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresChannelListener, requireDatabaseUrl } from './postgres-channel-listener';

export const COMMUNITY_CONNECTION_UPDATES_CHANNEL = 'community_connection_updates';

/**
 * Listens on `community_connection_updates`, the channel the
 * `community_connections` triggers notify with `{"op","id"}` whenever a row
 * is inserted, deleted, or changes in a way a client can see.
 */
@Injectable()
export class CommunityConnectionListenerService extends PostgresChannelListener {
  constructor(configService: ConfigService) {
    super(
      COMMUNITY_CONNECTION_UPDATES_CHANNEL,
      requireDatabaseUrl(configService),
      CommunityConnectionListenerService.name,
    );
  }
}

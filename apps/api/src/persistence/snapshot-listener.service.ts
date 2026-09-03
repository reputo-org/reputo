import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresChannelListener, requireDatabaseUrl } from './postgres-channel-listener';

export const SNAPSHOT_UPDATES_CHANNEL = 'snapshot_updates';

/**
 * Listens on `snapshot_updates`, the channel the `updateSnapshot` activity
 * notifies with the id of every snapshot it changed.
 */
@Injectable()
export class SnapshotListenerService extends PostgresChannelListener {
  constructor(configService: ConfigService) {
    super(SNAPSHOT_UPDATES_CHANNEL, requireDatabaseUrl(configService), SnapshotListenerService.name);
  }
}

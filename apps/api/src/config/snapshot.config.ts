import { registerAs } from '@nestjs/config';

import { env } from './env';

export default registerAs('snapshot', () => ({
  reconcileIntervalMs: env.SNAPSHOT_RECONCILE_INTERVAL_MS,
  reconcileGraceMs: env.SNAPSHOT_RECONCILE_GRACE_MS,
  startFailedAfterMs: env.SNAPSHOT_START_FAILED_AFTER_MS,
}));

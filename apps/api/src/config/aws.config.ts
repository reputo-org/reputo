import { registerAs } from '@nestjs/config';

import { env } from './env';

export default registerAs('aws', () => ({
  region: env.AWS_REGION,
  endpoint: env.STORAGE_ENDPOINT,
  forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
}));

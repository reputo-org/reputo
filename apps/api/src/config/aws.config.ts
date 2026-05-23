import { registerAs } from '@nestjs/config';

import { env } from './env';

export default registerAs('aws', () => ({
  region: env.AWS_REGION,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
}));

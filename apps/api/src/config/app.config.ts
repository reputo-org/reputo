import { registerAs } from '@nestjs/config';

import { env } from './env';

export default registerAs('app', () => ({
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
}));

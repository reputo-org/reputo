import { registerAs } from '@nestjs/config';

import { env } from './env';

export default registerAs('logger', () => ({
  level: env.LOG_LEVEL,
}));

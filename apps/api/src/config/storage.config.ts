import { registerAs } from '@nestjs/config';

import { env } from './env';

export default registerAs('storage', () => ({
  bucket: env.STORAGE_BUCKET,
  presignPutTtl: env.STORAGE_PRESIGN_PUT_TTL,
  presignGetTtl: env.STORAGE_PRESIGN_GET_TTL,
  maxSizeBytes: env.STORAGE_MAX_SIZE_BYTES,
  contentTypeAllowlist: env.STORAGE_CONTENT_TYPE_ALLOWLIST,
}));

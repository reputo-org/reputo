import { z } from 'zod';
import type { SealMetadata } from './types.js';

/**
 * The SEAL metadata document. Nothing is coerced: a string `scale`, an unknown
 * `schemeType`, or a missing field is a contract violation. Unknown extra
 * fields are tolerated and dropped.
 */
export const sealMetadataSchema: z.ZodType<SealMetadata> = z.object({
  id: z.string().min(1),
  schemeType: z.literal('ckks'),
  securityLevel: z.number().int().positive(),
  polyModulusDegree: z.number().int().positive(),
  coeffModulusBitSizes: z.array(z.number().int().positive()).min(1),
  scale: z.number().positive(),
  encryptionParameters: z.string().min(1),
});

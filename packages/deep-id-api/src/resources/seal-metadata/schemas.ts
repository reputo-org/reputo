import { z } from 'zod';
import type { SealMetadata } from './types.js';

const DECIMAL_STRING = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * DeepID serializes some numeric fields as strings. Only a plain decimal string
 * is converted, so everything else still fails against `schema` with its own
 * message — unlike `z.coerce.number()`, which turns `true` into `1` and `[128]`
 * into `128` and would hand SEAL a plausible but wrong parameter.
 */
function jsonNumber<T extends z.ZodType<number>>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && DECIMAL_STRING.test(value) ? Number(value) : value),
    schema,
  );
}

/**
 * The SEAL metadata document. An unknown `schemeType` or a missing field is a
 * contract violation. Unknown extra fields are tolerated and dropped.
 */
export const sealMetadataSchema: z.ZodType<SealMetadata> = z.object({
  id: z.string().min(1),
  schemeType: z.literal('ckks'),
  securityLevel: jsonNumber(z.number().int().positive()),
  polyModulusDegree: jsonNumber(z.number().int().positive()),
  coeffModulusBitSizes: z.array(jsonNumber(z.number().int().positive())).min(1),
  scale: jsonNumber(z.number().positive()),
  encryptionParameters: z.string().min(1),
});

import { z } from 'zod/v4';

export const algorithmPresetInputSchema: z.ZodObject<{
  key: z.ZodString;
  value: z.ZodUnknown;
}> = z.object({
  key: z.string().min(1, 'Input key is required'),
  value: z.unknown().refine((val) => val !== undefined && val !== null, {
    message: 'Input value is required',
  }),
});

export const createAlgorithmPresetSchema: z.ZodObject<{
  key: z.ZodString;
  version: z.ZodString;
  inputs: z.ZodArray<z.ZodObject<{ key: z.ZodString; value: z.ZodUnknown }>>;
  name: z.ZodOptional<z.ZodString>;
  description: z.ZodOptional<z.ZodString>;
}> = z.object({
  key: z.string().min(1, 'Algorithm key is required'),
  version: z.string().min(1, 'Algorithm version is required'),
  inputs: z.array(algorithmPresetInputSchema).min(1, 'At least one input is required'),
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(100, 'Name must be at most 100 characters')
    .optional(),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description must be at most 500 characters')
    .optional(),
});

export type CreateAlgorithmPresetInput = z.infer<typeof createAlgorithmPresetSchema>;

export type AlgorithmPresetInputType = z.infer<typeof algorithmPresetInputSchema>;

/**
 * @example
 * ```typescript
 * const result = validateCreateAlgorithmPreset({
 *   key: 'voting_engagement',
 *   version: '1.0.0',
 *   inputs: [{ key: 'threshold', value: 0.5 }],
 *   name: 'Voting Engagement',
 *   description: 'Calculates engagement based on voting patterns'
 * })
 *
 * if (result.success) {
 *   const preset: CreateAlgorithmPresetInput = result.data
 * } else {
 *   console.error('Validation errors:', result.error)
 * }
 * ```
 */
export function validateCreateAlgorithmPreset(data: unknown): ReturnType<typeof createAlgorithmPresetSchema.safeParse> {
  return createAlgorithmPresetSchema.safeParse(data);
}

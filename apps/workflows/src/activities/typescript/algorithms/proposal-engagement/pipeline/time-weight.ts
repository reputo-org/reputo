/** Time decay uses a fixed bucket size of 1 month. */
const DECAY_BUCKET_SIZE_MONTHS = 1;

export interface TimeWeightParams {
  engagementWindowMonths: number;
  monthlyDecayRatePercent: number;
}

export interface TimeWeightResult {
  tw: number;
  ageMonths: number;
  bucketIndex: number;
  isValid: boolean;
  isWithinWindow: boolean;
}

/**
 * The time weight decays in discrete buckets:
 * - Bucket 0: tw = 1.0
 * - Bucket 1: tw = 1.0 - decay_rate
 * - Bucket n: tw = 1.0 - n * decay_rate
 *
 * Proposals outside the engagement window get tw = 0.
 */
export function calculateTimeWeight(createdAt: Date, now: Date, params: TimeWeightParams): TimeWeightResult {
  const { engagementWindowMonths, monthlyDecayRatePercent } = params;

  const ageMs = now.getTime() - createdAt.getTime();
  const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30.44);

  if (ageMonths >= engagementWindowMonths) {
    return {
      tw: 0,
      ageMonths,
      bucketIndex: Math.floor(ageMonths / DECAY_BUCKET_SIZE_MONTHS),
      isValid: true,
      isWithinWindow: false,
    };
  }

  const bucketIndex = Math.floor(ageMonths / DECAY_BUCKET_SIZE_MONTHS);
  const tw = Math.max(0, 1 - bucketIndex * (monthlyDecayRatePercent / 100));

  return {
    tw,
    ageMonths,
    bucketIndex,
    isValid: true,
    isWithinWindow: tw > 0,
  };
}

export function computeTimeWeightFromString(
  createdAtStr: string,
  now: Date,
  params: TimeWeightParams,
): TimeWeightResult {
  const createdAt = new Date(createdAtStr);
  return calculateTimeWeight(createdAt, now, params);
}

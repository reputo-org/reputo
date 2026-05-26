export type Round = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  pool_id: { id: number }[];
  [key: string]: unknown;
};

export type RoundApiResponse = Round[];

export type RoundRecord = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  poolIds: string;
  rawJson: string;
};

export type RoundFetchOptions = Record<string, never>;

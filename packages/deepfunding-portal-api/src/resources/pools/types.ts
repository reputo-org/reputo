export type Pool = {
  id: number;
  name: string;
  slug: string;
  max_funding_amount: number;
  description: string | null;
  [key: string]: unknown;
};

export type PoolApiResponse = Pool[];

export type PoolRecord = {
  id: number;
  name: string;
  slug: string;
  maxFundingAmount: number;
  description: string | null;
  rawJson: string;
};

export type PoolFetchOptions = Record<string, never>;

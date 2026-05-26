import type { Pagination, PaginationOptions } from '../../shared/types/index.js';

export type User = {
  id: number;
  collection_id: string;
  user_name: string;
  email: string;
  total_proposals: number;
  [key: string]: unknown;
};

export type UserApiResponse = {
  users: User[];
  pagination: Pagination;
};

export type UserRecord = {
  id: number;
  collectionId: string;
  userName: string;
  email: string;
  totalProposals: number;
  rawJson: string;
};

export type UserFetchOptions = PaginationOptions;

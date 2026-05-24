export const endpoints = {
  rounds: () => '/rounds',
  pools: () => '/pools',
  proposals: (roundId: number) => `/rounds/${roundId}/proposals`,
  users: () => '/users',
  milestones: () => '/milestones',
  reviews: () => '/reviews',
  comments: () => '/comments',
  commentVotes: () => '/comment_votes',
} as const;

export type EndpointKey = keyof typeof endpoints;

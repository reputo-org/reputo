// Shared pagination helper. Every repository returns the same
// `{ results, page, limit, totalPages, totalResults }` shape that the API
// DTOs and e2e tests expect.

export interface PaginateOptions {
  page?: number;
  limit?: number;
  /** Comma-separated `field:dir` list, e.g. `createdAt:desc,key:asc`. */
  sortBy?: string;
}

export interface PaginateResult<T> {
  results: T[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
}

export interface PrismaPaginateModel<TWhere, TOrderBy, TRow> {
  count(args: { where?: TWhere }): Promise<number>;
  findMany(args: { where?: TWhere; orderBy?: TOrderBy | TOrderBy[]; skip?: number; take?: number }): Promise<TRow[]>;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

export function parseSortBy<TOrderBy extends Record<string, 'asc' | 'desc'>>(
  sortBy: string | undefined,
  fallback: TOrderBy,
): TOrderBy[] {
  if (!sortBy) {
    return [fallback];
  }

  const orderBy: TOrderBy[] = [];
  for (const fragment of sortBy.split(',')) {
    const [field, dir] = fragment.trim().split(':');
    if (!field) continue;
    const direction = dir?.toLowerCase() === 'asc' ? 'asc' : 'desc';
    orderBy.push({ [field]: direction } as TOrderBy);
  }

  return orderBy.length > 0 ? orderBy : [fallback];
}

export async function paginate<TWhere, TOrderBy extends Record<string, 'asc' | 'desc'>, TRow, TResult>(args: {
  model: PrismaPaginateModel<TWhere, TOrderBy, TRow>;
  where?: TWhere;
  options: PaginateOptions;
  defaultOrderBy: TOrderBy;
  mapRow: (row: TRow) => TResult;
}): Promise<PaginateResult<TResult>> {
  const page = Math.max(1, args.options.page ?? DEFAULT_PAGE);
  const limit = Math.max(1, args.options.limit ?? DEFAULT_LIMIT);
  const orderBy = parseSortBy<TOrderBy>(args.options.sortBy, args.defaultOrderBy);

  const [totalResults, rows] = await Promise.all([
    args.model.count({ where: args.where }),
    args.model.findMany({
      where: args.where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    results: rows.map(args.mapRow),
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit),
    totalResults,
  };
}

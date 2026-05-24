import type { FindManyOptions, FindOptionsOrder, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';

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

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

/**
 * Parses a `field:dir` comma list into a single TypeORM `FindOptionsOrder`
 * object. When `sortBy` is missing or empty, the fallback order is returned.
 */
export function parseSortBy<TEntity extends ObjectLiteral>(
  sortBy: string | undefined,
  fallback: FindOptionsOrder<TEntity>,
): FindOptionsOrder<TEntity> {
  if (!sortBy) {
    return fallback;
  }

  const orderBy: Record<string, 'ASC' | 'DESC'> = {};
  for (const fragment of sortBy.split(',')) {
    const [field, dir] = fragment.trim().split(':');
    if (!field) continue;
    orderBy[field] = dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  }

  return (Object.keys(orderBy).length > 0 ? orderBy : fallback) as FindOptionsOrder<TEntity>;
}

export interface PaginateArgs<TEntity extends ObjectLiteral, TResult> {
  repository: Repository<TEntity>;
  where?: FindOptionsWhere<TEntity> | FindOptionsWhere<TEntity>[];
  options: PaginateOptions;
  defaultOrderBy: FindOptionsOrder<TEntity>;
  /** Extra `find` options (relations, select, …) layered on top of paging. */
  extra?: Omit<FindManyOptions<TEntity>, 'where' | 'order' | 'skip' | 'take'>;
  mapRow: (row: TEntity) => TResult;
}

export async function paginate<TEntity extends ObjectLiteral, TResult>(
  args: PaginateArgs<TEntity, TResult>,
): Promise<PaginateResult<TResult>> {
  const page = Math.max(1, args.options.page ?? DEFAULT_PAGE);
  const limit = Math.max(1, args.options.limit ?? DEFAULT_LIMIT);
  const order = parseSortBy<TEntity>(args.options.sortBy, args.defaultOrderBy);

  const [rows, totalResults] = await args.repository.findAndCount({
    ...(args.extra ?? {}),
    where: args.where,
    order,
    skip: (page - 1) * limit,
    take: limit,
  });

  return {
    results: rows.map(args.mapRow),
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit),
    totalResults,
  };
}

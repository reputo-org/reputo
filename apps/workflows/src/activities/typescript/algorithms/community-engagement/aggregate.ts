import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { LocalCommunityDataset } from './dataset.js';
import type {
  ActivityUnitTotals,
  ActivityWeight,
  CohortMemberRow,
  CommunityEngagementConfig,
  CoverageRow,
} from './types.js';

/** Doc-mandated DuckDB runtime settings, same as the dataset engine's. */
const DUCKDB_MEMORY_LIMIT = '1GB';
const DUCKDB_THREADS = '2';

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export interface CommunityAggregationResult {
  cohort: CohortMemberRow[];
  coverage: CoverageRow[];
  /** Integer unit totals per (did, activity), daily caps already applied in SQL. */
  totals: Map<string, Map<string, ActivityUnitTotals>>;
}

/**
 * Aggregates the frozen dataset in SQL: integer unit counts per (user,
 * activity, UTC day), daily caps applied per day (and, for the derived
 * active-day activity, on the total number of credited days). Bots are
 * excluded here; matching is by the cohort's frozen platform account id.
 */
export async function aggregateCommunityActivity(args: {
  dataset: LocalCommunityDataset;
  weights: Map<string, ActivityWeight>;
  activeDay?: CommunityEngagementConfig['activeDay'];
}): Promise<CommunityAggregationResult> {
  const { dataset, weights, activeDay } = args;

  const duckdbTmpDir = join(dataset.scratch, 'duckdb-tmp');
  await mkdir(duckdbTmpDir, { recursive: true });
  const instance = await DuckDBInstance.create(':memory:', {
    memory_limit: DUCKDB_MEMORY_LIMIT,
    threads: DUCKDB_THREADS,
    temp_directory: duckdbTmpDir,
  });
  const connection = await instance.connect();

  try {
    const cohortResult = await connection.runAndReadAll(
      `SELECT did, username, account_id, status FROM read_parquet(${quote(dataset.cohortPath)}) ORDER BY did`,
    );
    const cohort: CohortMemberRow[] = cohortResult.getRowObjects().map((row) => ({
      did: String(row.did),
      username: row.username === null ? null : String(row.username),
      accountId: row.account_id === null ? null : String(row.account_id),
      status: String(row.status),
    }));

    const coverageResult = await connection.runAndReadAll(
      `SELECT resource, status, reason FROM read_parquet(${quote(dataset.coveragePath)}) ORDER BY resource`,
    );
    const coverage: CoverageRow[] = coverageResult.getRowObjects().map((row) => ({
      resource: String(row.resource),
      status: String(row.status),
      ...(row.reason === null ? {} : { reason: String(row.reason) }),
    }));

    const activeDayWeight = activeDay === undefined ? undefined : weights.get(activeDay.type);
    const regularTypes = [...weights.keys()].filter((type) => type !== activeDay?.type);

    const selects: string[] = [];
    if (regularTypes.length > 0) {
      const capValues = regularTypes.map((type) => `(${quote(type)}, ${weights.get(type)?.dailyCap ?? 0})`).join(', ');
      selects.push(
        `SELECT u.did AS did, u.type AS type,
                CAST(sum(u.units) AS BIGINT) AS units,
                CAST(sum(LEAST(u.units, c.cap)) AS BIGINT) AS capped_units
         FROM day_units u JOIN (VALUES ${capValues}) AS c(type, cap) ON c.type = u.type
         GROUP BY u.did, u.type`,
      );
    }
    if (activeDay !== undefined && activeDayWeight !== undefined) {
      const sourceList = activeDay.sourceTypes.map(quote).join(', ');
      selects.push(
        `SELECT did, ${quote(activeDay.type)} AS type,
                CAST(count(*) AS BIGINT) AS units,
                CAST(LEAST(count(*), ${activeDayWeight.dailyCap}) AS BIGINT) AS capped_units
         FROM (SELECT DISTINCT did, day FROM day_units WHERE type IN (${sourceList}))
         GROUP BY did`,
      );
    }

    const totals = new Map<string, Map<string, ActivityUnitTotals>>();
    if (selects.length > 0) {
      const totalsResult = await connection.runAndReadAll(
        `WITH day_units AS (
           SELECT c.did AS did, a.type AS type, CAST(a.occurred_at AS DATE) AS day, sum(a.count) AS units
           FROM read_parquet(${quote(dataset.activitiesPath)}) a
           JOIN read_parquet(${quote(dataset.cohortPath)}) c ON c.account_id = a.actor
           WHERE NOT a.bot
           GROUP BY c.did, a.type, CAST(a.occurred_at AS DATE)
         )
         ${selects.join('\n UNION ALL \n')}
         ORDER BY did, type`,
      );
      for (const row of totalsResult.getRowObjects()) {
        const did = String(row.did);
        const byType = totals.get(did) ?? new Map<string, ActivityUnitTotals>();
        byType.set(String(row.type), { units: Number(row.units), cappedUnits: Number(row.capped_units) });
        totals.set(did, byType);
      }
    }

    return { cohort, coverage, totals };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

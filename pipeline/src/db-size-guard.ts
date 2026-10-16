import { createPipelineDbConnection, type PipelineDbConnection } from './load';

export const MAX_DB_SIZE_MB = 450;
export const MAX_DB_SIZE_BYTES = MAX_DB_SIZE_MB * 1024 * 1024;

export interface DbSizeCheckResult {
  readonly sizeBytes: number;
  readonly sizeMb: number;
  readonly limitMb: number;
  readonly withinBudget: boolean;
}

/**
 * Pure helper evaluating whether a database size in bytes is within the 450 MB free-tier guard.
 */
export function evaluateDbSizeBytes(
  sizeBytes: number,
  maxBytes: number = MAX_DB_SIZE_BYTES,
): DbSizeCheckResult {
  const sizeMb = Number((sizeBytes / (1024 * 1024)).toFixed(2));
  const limitMb = Number((maxBytes / (1024 * 1024)).toFixed(2));
  return {
    sizeBytes,
    sizeMb,
    limitMb,
    withinBudget: sizeBytes <= maxBytes,
  };
}

/**
 * Queries the current Postgres database size in bytes (via `pg_database_size(current_database())`
 * when a direct SQL connection is available, or estimates from catalog row counts via PostgREST).
 */
export async function queryDatabaseSizeBytes(conn: PipelineDbConnection): Promise<number> {
  if (conn.sql) {
    const rows = await conn.sql<Array<{ size_bytes: string | number }>>`
      select pg_database_size(current_database()) as size_bytes
    `;
    const raw = rows[0]?.size_bytes ?? 0;
    return typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  }

  if (conn.supabase) {
    const [moviesCountRes, embCountRes, peopleCountRes] = await Promise.all([
      conn.supabase.from('movies').select('*', { count: 'exact', head: true }),
      conn.supabase.from('movie_embeddings').select('*', { count: 'exact', head: true }),
      conn.supabase.from('people').select('*', { count: 'exact', head: true }),
    ]);

    const moviesCount = moviesCountRes.count ?? 0;
    const embCount = embCountRes.count ?? 0;
    const peopleCount = peopleCountRes.count ?? 0;

    // Conservative per-row storage + index overhead estimate matching docs/database.md §Storage budget
    const estimatedBytes =
      12 * 1024 * 1024 + // base Postgres + extensions overhead
      moviesCount * 420 +
      embCount * 1680 + // halfvec(384) + HNSW index
      peopleCount * 320;
    return estimatedBytes;
  }

  return 0;
}

export async function runDbSizeGuard(): Promise<DbSizeCheckResult> {
  const conn = createPipelineDbConnection();
  try {
    const sizeBytes = await queryDatabaseSizeBytes(conn);
    const result = evaluateDbSizeBytes(sizeBytes);
    console.log(
      `[db-size-guard] Database size: ${result.sizeMb} MB / ${result.limitMb} MB (${
        result.withinBudget ? 'PASS' : 'FAIL'
      })`,
    );
    if (!result.withinBudget) {
      throw new Error(
        `Database size (${result.sizeMb} MB) exceeds free-tier budget limit of ${result.limitMb} MB.`,
      );
    }
    return result;
  } finally {
    await conn.close();
  }
}

if (import.meta.main) {
  runDbSizeGuard().catch((err: unknown) => {
    console.error('[db-size-guard] Error:', err);
    process.exit(1);
  });
}

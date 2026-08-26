import { Client } from "pg";
import { getSqlExecutor } from "@/lib/data/postgres-client";
import type { SqlExecutor } from "@/lib/data/postgres-repository";

/**
 * Integration-test plumbing.
 *
 * These tests talk to a **real PostgreSQL server**. That is the entire point:
 * Phase 4's unit tests ran against a fake executor with no types, no
 * constraints and no foreign keys, and it passed every one of them while the
 * real SQL was broken in four separate places.
 *
 * They are skipped — not failed — when `TEST_DATABASE_URL` is unset, so
 * `npm test` still runs anywhere. `npm run test:integration` with the variable
 * set is what exercises them.
 *
 * ```bash
 * export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/mtl_test
 * npm run db:migrate            # DATABASE_URL must point at the same database
 * npm run test:integration
 * ```
 *
 * ⚠️ `truncateAll()` deletes data. It refuses to run against a connection
 * string that is not obviously a test database, because a test helper that can
 * empty production is a loaded gun on the table.
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function describeIfDb(): { skip: boolean; reason: string } {
  return TEST_DATABASE_URL
    ? { skip: false, reason: "" }
    : { skip: true, reason: "TEST_DATABASE_URL is not set — skipping PostgreSQL integration tests" };
}

export function sql(): SqlExecutor {
  const executor = getSqlExecutor(TEST_DATABASE_URL);
  if (!executor) throw new Error("TEST_DATABASE_URL is not set");
  return executor;
}

/** Tables the tests write to. Reference data (lenders, geography) is left alone. */
const MUTABLE_TABLES = [
  "market_benchmarks",
  "civic_permit_stats",
  "mortgage_rates",
  "sale_market_stats",
  "rental_market_stats",
  "alert_incidents",
  "import_runs",
];

function looksLikeATestDatabase(url: string): boolean {
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  return /test|_ci$|scratch|local/i.test(name) || /localhost|127\.0\.0\.1/.test(url);
}

export async function truncateAll(): Promise<void> {
  if (!TEST_DATABASE_URL) return;
  if (!looksLikeATestDatabase(TEST_DATABASE_URL)) {
    throw new Error(
      "Refusing to truncate: TEST_DATABASE_URL does not look like a test database. " +
        "Point it at a database whose name contains 'test', or one on localhost.",
    );
  }
  const executor = sql();
  // One statement, so foreign keys between these tables cannot block it.
  await executor(`TRUNCATE ${MUTABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/** Assert the migrations have been applied, with an actionable message if not. */
export async function assertSchema(): Promise<void> {
  const executor = sql();
  const rows = await executor<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [[...MUTABLE_TABLES, "data_sources", "lenders", "civic_geography"]],
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = [...MUTABLE_TABLES, "data_sources", "lenders", "civic_geography"].filter(
    (table) => !present.has(table),
  );
  if (missing.length > 0) {
    throw new Error(
      `The test database is missing ${missing.join(", ")}. Run:\n` +
        `  DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate`,
    );
  }
}

/**
 * Open a **separate** connection, bypassing the pool.
 *
 * Used to prove durability: writing through one connection and reading through
 * another that knows nothing about it is the closest thing to a restart that a
 * test can do without actually restarting anything.
 */
export async function withFreshConnection<T>(
  fn: (query: SqlExecutor) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const executor: SqlExecutor = async <TRow = Record<string, unknown>>(
      text: string,
      params: unknown[] = [],
    ) => (await client.query(text, params)).rows as TRow[];
    return await fn(executor);
  } finally {
    await client.end();
  }
}

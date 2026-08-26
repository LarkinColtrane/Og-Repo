import { Pool, type PoolConfig } from "pg";
import type { SqlExecutor } from "./postgres-repository";

/**
 * The real database connection.
 *
 * This is the piece every `Postgres*Repository` has been waiting for. Those
 * classes were written against a ten-line interface — `SqlExecutor` — precisely
 * so that connecting a database would be *this* file and nothing else. Nothing
 * in a route, a component or a repository changes because this now exists.
 *
 * ## Server-only
 *
 * `DATABASE_URL` has no `NEXT_PUBLIC_` prefix, so Next.js will not inline it
 * into a client bundle, and this module is imported only from server code. A
 * connection string is a credential: it contains the password, and anything
 * that reaches the browser reaches everyone. `tests/security.test.ts` asserts
 * this mechanically rather than trusting the convention.
 *
 * ## One pool per process
 *
 * A pool is cached on `globalThis`. In development Next.js re-evaluates modules
 * on every hot reload; a module-level `let` would leak a new pool each time
 * until the database refused connections. The global survives reload, which is
 * the standard shape for this problem and the reason it looks slightly odd.
 */

const POOL_KEY = Symbol.for("mtl.pgPool");

interface GlobalWithPool {
  [POOL_KEY]?: Pool;
}

/**
 * Whether a connection string needs TLS.
 *
 * Hosted providers (Supabase, Neon, RDS) require it; a local server usually has
 * no certificate at all and refuses. Guessing wrong fails the connection either
 * way, so the rule is explicit: honour `PGSSL` when set, otherwise turn TLS on
 * for anything that is not plainly local.
 *
 * `rejectUnauthorized: false` is deliberate and narrow. Several managed
 * providers terminate TLS with a certificate chain that Node's default store
 * does not recognise, and the practical alternatives are to ship their CA
 * bundle or to disable verification. This still encrypts the connection; it does
 * not authenticate the server. Set `PGSSL=verify` once you have the provider's
 * CA in place, which is the better end state.
 */
export function resolveSsl(
  connectionString: string,
  pgssl: string | undefined = process.env.PGSSL,
): PoolConfig["ssl"] {
  if (pgssl === "disable" || pgssl === "false") return undefined;
  if (pgssl === "verify") return { rejectUnauthorized: true };
  if (pgssl === "require" || pgssl === "true") return { rejectUnauthorized: false };

  const isLocal =
    /@(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)[:/]/.test(connectionString) ||
    /^postgres(ql)?:\/\/[^@]*@?(localhost|127\.0\.0\.1)/.test(connectionString);

  return isLocal ? undefined : { rejectUnauthorized: false };
}

export function getPool(connectionString = process.env.DATABASE_URL): Pool | null {
  if (!connectionString) return null;

  const globalRef = globalThis as GlobalWithPool;
  if (globalRef[POOL_KEY]) return globalRef[POOL_KEY];

  const pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    // Serverless platforms run many short-lived instances against one database.
    // A large pool per instance is how a Postgres connection limit gets hit by
    // an application with almost no traffic.
    max: Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool emits `error` for idle clients dropped by the server — routine with
  // hosted providers that recycle connections. Unhandled, it takes the process
  // down. The message is logged without the connection string.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });

  globalRef[POOL_KEY] = pool;
  return pool;
}

/**
 * A `SqlExecutor` backed by a real connection pool.
 *
 * Every query is parameterised — `$1`, `$2` — and no repository in this codebase
 * concatenates a value into SQL. That is what makes injection structurally
 * impossible here rather than merely unlikely.
 */
export function createSqlExecutor(pool: Pool): SqlExecutor {
  return async <TRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const result = await pool.query(sql, params);
    return result.rows as TRow[];
  };
}

/** The executor for this process, or null when no database is configured. */
export function getSqlExecutor(
  connectionString = process.env.DATABASE_URL,
): SqlExecutor | null {
  const pool = getPool(connectionString);
  return pool ? createSqlExecutor(pool) : null;
}

/**
 * Hide the password in a connection string before printing it.
 *
 * Anything that logs a database URL must go through this. A connection string
 * in a build log, a crash report or a screenshot is a leaked credential, and it
 * is leaked to everyone who can read that log.
 */
export function redactConnectionString(connectionString: string): string {
  // Greedy on the password, so it runs to the LAST '@' before the host. A
  // non-greedy match stops at the first '@', which leaves the rest of a
  // password like `p@ss:w0rd!` visible — the exact case that made this a bug
  // rather than a formality.
  return connectionString.replace(/\/\/([^:/@]+):(.*)@/, "//$1:***@");
}

/** Close the pool. For tests and for a graceful shutdown. */
export async function closePool(): Promise<void> {
  const globalRef = globalThis as GlobalWithPool;
  const pool = globalRef[POOL_KEY];
  if (!pool) return;
  delete globalRef[POOL_KEY];
  await pool.end();
}

/**
 * The migration runner.
 *
 * ```bash
 * npm run db:migrate            # apply anything outstanding
 * npm run db:migrate -- --status  # show what is applied, without changing anything
 * ```
 *
 * ## Why a runner and not "paste the files into psql"
 *
 * Phase 4 shipped four `.sql` files and an instruction to run them by hand, in
 * order. That works exactly once, on one machine, by someone who remembers the
 * order. It does not survive a second environment, a teammate, or a deployment.
 *
 * This tracks what has been applied in the database itself, so:
 *
 *  - running it twice is safe (the second run applies nothing);
 *  - a new migration is picked up automatically;
 *  - a *changed* migration that was already applied is detected by checksum and
 *    reported, because editing an applied migration means the file no longer
 *    describes the database and every other environment will diverge.
 *
 * ## Each migration runs in a transaction
 *
 * The files already contain `BEGIN`/`COMMIT`. PostgreSQL treats a nested
 * `BEGIN` as a no-op with a warning, so this wraps the whole file — including
 * the bookkeeping insert — in one transaction of its own. A migration that
 * fails halfway leaves nothing behind and is not recorded as applied.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Client } from "pg";
import { redactConnectionString, resolveSsl } from "../lib/data/postgres-client";

const MIGRATIONS_DIR = join(process.cwd(), "docs", "sql");

interface Migration {
  filename: string;
  sql: string;
  checksum: string;
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    // Filenames are numbered (`001_…`), so lexical order is dependency order.
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
      return {
        filename,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex").slice(0, 16),
      };
    });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "  Local:  export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/mtl_market\n" +
        "  Hosted: copy the connection string from your provider — see docs/DATABASE_OPERATIONS.md",
    );
    process.exit(1);
  }

  const statusOnly = process.argv.includes("--status");
  const client = new Client({ connectionString, ssl: resolveSsl(connectionString) });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ filename: string; checksum: string; applied_at: Date }>(
      `SELECT filename, checksum, applied_at FROM schema_migrations`,
    );
    const applied = new Map(rows.map((row) => [row.filename, row]));
    const migrations = loadMigrations();

    if (statusOnly) {
      console.log(`Database: ${redactConnectionString(connectionString)}\n`);
      for (const migration of migrations) {
        const record = applied.get(migration.filename);
        if (!record) {
          console.log(`  PENDING   ${migration.filename}`);
        } else if (record.checksum !== migration.checksum) {
          console.log(
            `  CHANGED   ${migration.filename}  ← applied ${record.applied_at.toISOString()}, but the file has been edited since`,
          );
        } else {
          console.log(`  applied   ${migration.filename}  ${record.applied_at.toISOString()}`);
        }
      }
      return;
    }

    // An edited migration is reported but not re-run: re-running it would fail
    // on the objects it already created, and silently ignoring it would let two
    // environments drift apart while both claimed to be up to date. The fix is
    // a NEW migration, which is why this stops rather than guessing.
    const drifted = migrations.filter(
      (m) => applied.has(m.filename) && applied.get(m.filename)!.checksum !== m.checksum,
    );
    if (drifted.length > 0) {
      console.error(
        `Refusing to run. These migrations were edited after being applied:\n` +
          drifted.map((m) => `  ${m.filename}`).join("\n") +
          `\n\nAn applied migration is history. Add a new file instead.\n` +
          `If the edit was cosmetic and you are certain the database matches, update the\n` +
          `recorded checksum:\n` +
          `  UPDATE schema_migrations SET checksum = '<new>' WHERE filename = '<file>';`,
      );
      process.exit(1);
    }

    const pending = migrations.filter((m) => !applied.has(m.filename));
    if (pending.length === 0) {
      console.log(`Up to date — ${migrations.length} migration(s) already applied.`);
      return;
    }

    for (const migration of pending) {
      process.stdout.write(`  applying ${migration.filename} … `);
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`,
          [migration.filename, migration.checksum],
        );
        await client.query("COMMIT");
        console.log("ok");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.log("FAILED");
        // The real cause, not a wrapped one. A migration failure is almost
        // always a specific PostgreSQL message and hiding it wastes the hour it
        // takes to rediscover.
        console.error(`\n${(error as Error).message}\n`);
        process.exit(1);
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

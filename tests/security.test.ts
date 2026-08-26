import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { redactConnectionString as redact } from "@/lib/data/postgres-client";

/**
 * Secrets must not leak.
 *
 * Written as tests rather than a checklist because a checklist is verified once
 * and a test is verified on every run. Each of these corresponds to a real way
 * a credential escapes: bundled into client JavaScript, echoed in an API
 * response, committed to Git, or printed to a log.
 */

const ROOT = new URL("..", import.meta.url).pathname;

const SECRET_ENV_NAMES = [
  "DATABASE_URL",
  "MARKET_INGEST_SECRET",
  "PIPELINE_ALERT_WEBHOOK_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "IMPORT_API_KEY",
  "RATE_FEED_API_KEY",
  "LISTINGS_API_KEY",
];

function sourceFiles(dir = ROOT, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "coverage"].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, files);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(path)) files.push(path);
  }
  return files;
}

const FILES = sourceFiles();

describe("secrets never reach the browser", () => {
  it("no secret is given a NEXT_PUBLIC_ prefix", () => {
    // NEXT_PUBLIC_ is the ONLY thing that makes Next.js inline an environment
    // variable into client JavaScript. Prefixing a secret publishes it.
    for (const file of FILES) {
      const contents = readFileSync(file, "utf8");
      for (const name of SECRET_ENV_NAMES) {
        assert.ok(
          !contents.includes(`NEXT_PUBLIC_${name}`),
          `${file} would inline ${name} into the client bundle`,
        );
      }
    }
  });

  it("no client component reads a secret", () => {
    for (const file of FILES) {
      if (file.includes("/tests/")) continue;
      const contents = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(contents)) continue;
      for (const name of SECRET_ENV_NAMES) {
        assert.ok(
          !contents.includes(name),
          `${file} is a client component and references ${name}`,
        );
      }
    }
  });

  it("the database client is never imported from a client component", () => {
    // Importing it would pull `pg` — and the connection string — toward the
    // browser bundle.
    for (const file of FILES) {
      const contents = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(contents)) continue;
      assert.ok(
        !/from "@\/lib\/data\/postgres-client"/.test(contents),
        `${file} is a client component and imports the database client`,
      );
    }
  });
});

describe("secrets never reach Git", () => {
  it(".env.local and .env are ignored", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /^\.env\*\.local$/m);
  });

  it("no .env file with real values is tracked", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((path) => /(^|\/)\.env/.test(path));
    // `.env.example` is a template of empty keys and is meant to be committed.
    assert.deepEqual(tracked.filter((path) => path !== ".env.example"), []);
  });

  it(".env.example carries placeholders, never real credentials", () => {
    // A template value is useful — it shows the shape of a connection string to
    // someone who has never seen one. What must never appear is something that
    // could actually authenticate.
    const PLACEHOLDER = /^$|your-|user:password|<.+>|example|changeme|xxx/i;
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");

    for (const line of example.split("\n")) {
      const match = /^#?\s*([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, name, value] = match;
      if (!SECRET_ENV_NAMES.includes(name)) continue;
      assert.ok(
        PLACEHOLDER.test(value.trim()),
        `.env.example gives ${name} a value that does not look like a placeholder: ${value}`,
      );
    }
  });
});

describe("secrets never reach a log or a response", () => {
  it("no connection string is logged with its password", () => {
    assert.equal(
      redact("postgresql://postgres:sup3rs3cret@db.example.co:5432/appdb"),
      "postgresql://postgres:***@db.example.co:5432/appdb",
    );
  });

  it("redaction survives a password containing punctuation", () => {
    const redacted = redact("postgres://u:p@ss:w0rd!@host:5432/db");
    assert.ok(!redacted.includes("w0rd!"), redacted);
  });

  it("the pool's error handler logs a message, not the configuration", () => {
    const source = readFileSync(join(ROOT, "lib/data/postgres-client.ts"), "utf8");
    const handler = /pool\.on\("error"[\s\S]*?\}\);/.exec(source)?.[0] ?? "";
    assert.ok(handler.length > 0, "the pool has an error handler");
    assert.ok(
      !/connectionString|process\.env/.test(handler),
      "the error handler must not print connection details",
    );
  });

  it("no route echoes an environment variable into a response body", () => {
    const routes = FILES.filter((file) => /app\/api\/.*route\.tsx?$/.test(file));
    assert.ok(routes.length > 0, "there are API routes to check");
    for (const file of routes) {
      const contents = readFileSync(file, "utf8");
      for (const name of SECRET_ENV_NAMES) {
        assert.ok(
          !new RegExp(`process\\.env\\.${name}`).test(contents),
          `${file} reads ${name} directly — go through lib/api/ingest-auth.ts or lib/data instead`,
        );
      }
    }
  });
});

describe("SQL is parameterised", () => {
  /**
   * Every query in the repositories uses `$1`, `$2` placeholders. This looks
   * for a value interpolated into SQL, which is the shape injection takes.
   */
  it("no repository interpolates a value into a SQL string", () => {
    const dataFiles = FILES.filter(
      (file) => /lib\/data\/.*\.ts$/.test(file) && !file.includes(".test."),
    );
    const offenders: string[] = [];

    for (const file of dataFiles) {
      const contents = readFileSync(file, "utf8");
      // Template literals containing SQL keywords AND a `${...}` substitution.
      for (const literal of contents.match(/`[^`]*`/g) ?? []) {
        if (!/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(literal)) continue;
        if (!/\$\{/.test(literal)) continue;
        offenders.push(`${file}: ${literal.slice(0, 120).replace(/\n\s*/g, " ")}`);
      }
    }

    assert.deepEqual(offenders, [], `SQL built by interpolation:\n${offenders.join("\n")}`);
  });

  it("the truncate helper refuses a non-test database", async () => {
    // A test helper that can empty production is a loaded gun on the table.
    const helper = readFileSync(join(ROOT, "tests/integration/helper.ts"), "utf8");
    assert.match(helper, /looksLikeATestDatabase/);
    assert.match(helper, /Refusing to truncate/);
  });
});

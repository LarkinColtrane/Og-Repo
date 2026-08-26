import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getAlertIncidentStore,
  getBenchmarkRepository,
  getCivicRepository,
  getImportRunStore,
  getMortgageRateRepository,
  getRepository,
  resetAllRepositories,
} from "@/lib/data";
import { closePool, resolveSsl } from "@/lib/data/postgres-client";

/**
 * Which store backs which dataset, and why.
 *
 * No database is needed: `pg` builds a pool lazily and does not connect until a
 * query runs, so the *selection* can be tested anywhere. What actually happens
 * over the wire is `tests/integration/postgres.test.ts`.
 */

const FAKE_URL = "postgresql://user:pw@db.example.test:5432/appdb";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAllRepositories();
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetAllRepositories();
  }
}

afterEach(async () => {
  resetAllRepositories();
  await closePool();
});

describe("with no DATABASE_URL", () => {
  it("serves every dataset from the generated fallbacks", () => {
    withEnv({ DATABASE_URL: undefined, MARKET_DATA_SOURCE: undefined, MORTGAGE_RATES_SOURCE: undefined }, () => {
      assert.equal(getRepository().dataQuality, "demo");
      assert.equal(getMortgageRateRepository().dataQuality, "demo");
      assert.equal(getBenchmarkRepository().dataQuality, "demo");
      assert.equal(getCivicRepository().dataQuality, "demo");
    });
  });

  it("keeps operational state in memory, and says so", () => {
    withEnv({ DATABASE_URL: undefined }, () => {
      assert.match(getImportRunStore().name, /In-memory/);
      assert.equal(getAlertIncidentStore().durable, false);
      assert.match(getAlertIncidentStore().name, /In-memory/);
    });
  });
});

describe("with DATABASE_URL set", () => {
  it("switches the four datasets that have an importer", () => {
    withEnv({ DATABASE_URL: FAKE_URL }, () => {
      assert.equal(getBenchmarkRepository().name, "PostgreSQL");
      assert.equal(getCivicRepository().name, "PostgreSQL");
      assert.match(getImportRunStore().name, /PostgreSQL/);
      assert.match(getAlertIncidentStore().name, /PostgreSQL/);
    });
  });

  it("makes operational state durable", () => {
    // §7: the sequence this prevents is fail → alert → restart → alert again.
    withEnv({ DATABASE_URL: FAKE_URL }, () => {
      assert.equal(getAlertIncidentStore().durable, true);
    });
  });

  /**
   * The regression this pins down.
   *
   * Wiring all six repositories to `DATABASE_URL` broke the production build
   * the first time it met a real database:
   *
   *     Error occurred prerendering page "/"
   *     Error: No sale statistics on record.
   *
   * — because there is no importer for market statistics, so the table is empty
   * the minute after the migrations run. That is the exact state of a brand-new
   * database, so the first deploy would have failed before serving a request.
   */
  it("does NOT switch datasets that have no importer", () => {
    withEnv({ DATABASE_URL: FAKE_URL, MARKET_DATA_SOURCE: undefined, MORTGAGE_RATES_SOURCE: undefined }, () => {
      assert.equal(
        getRepository().dataQuality,
        "demo",
        "market statistics have no importer — connecting a database must not make an empty table authoritative",
      );
      assert.equal(getMortgageRateRepository().dataQuality, "demo");
    });
  });

  it("switches them when explicitly opted in", () => {
    withEnv({ DATABASE_URL: FAKE_URL, MARKET_DATA_SOURCE: "postgres", MORTGAGE_RATES_SOURCE: "postgres" }, () => {
      assert.equal(getRepository().name, "PostgreSQL");
      assert.equal(getMortgageRateRepository().name, "PostgreSQL");
    });
  });

  it("ignores an opt-in flag with no database behind it", () => {
    withEnv({ DATABASE_URL: undefined, MARKET_DATA_SOURCE: "postgres" }, () => {
      assert.equal(getRepository().dataQuality, "demo");
    });
  });

  /**
   * §18: once a dataset reads from PostgreSQL, nothing switches it back.
   *
   * Selection depends only on configuration — never on whether the table has
   * rows or whether the last import succeeded. So an upstream outage leaves the
   * stored observations in place and the interface reports them as stale; it
   * cannot substitute generated numbers, because after this point there is no
   * code path that returns the demo repository.
   */
  it("never reverts to demo once configured, whatever the data looks like", () => {
    withEnv({ DATABASE_URL: FAKE_URL }, () => {
      for (let i = 0; i < 3; i += 1) {
        resetAllRepositories();
        assert.equal(getBenchmarkRepository().dataQuality, "live");
        assert.equal(getCivicRepository().dataQuality, "live");
      }
    });
  });
});

describe("resolveSsl", () => {
  it("requires TLS for a hosted database", () => {
    assert.deepEqual(resolveSsl("postgresql://u:p@db.supabase.co:5432/postgres", undefined), {
      rejectUnauthorized: false,
    });
  });

  it("skips TLS for a local server, which usually has no certificate", () => {
    assert.equal(resolveSsl("postgresql://postgres@127.0.0.1:5432/mtl", undefined), undefined);
    assert.equal(resolveSsl("postgresql://postgres@localhost:5432/mtl", undefined), undefined);
  });

  it("honours an explicit PGSSL", () => {
    assert.equal(resolveSsl("postgresql://u:p@remote:5432/db", "disable"), undefined);
    assert.deepEqual(resolveSsl("postgresql://postgres@127.0.0.1:5432/db", "require"), {
      rejectUnauthorized: false,
    });
    assert.deepEqual(resolveSsl("postgresql://u:p@remote:5432/db", "verify"), {
      rejectUnauthorized: true,
    });
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MontrealOpenDataConnector } from "@/lib/pipeline/connectors/montreal-open-data/client";
import { MONTREAL_PERMITS } from "@/lib/pipeline/connectors/montreal-open-data/datasets";
import {
  CivicIngestFailedError,
  ingestMontrealPermits,
} from "@/lib/pipeline/ingest/montreal-permits";
import { PostgresCivicDataRepository } from "@/lib/data/postgres-civic-repository";
import { DemoCivicDataRepository } from "@/lib/data/demo-civic-repository";
import { InMemoryImportRunStore } from "@/lib/data/import-run-store";
import type { BoroughPermitStat } from "@/types/civic";
import { createFakeCivicDb } from "./fixtures/fake-civic-sql";
import { createCkanFetch, packageResponse, permitRow } from "./fixtures/ckan";

/**
 * The whole civic pipeline, end to end, with no network and no database.
 *
 * The contract every one of these turns on: **an import run is always
 * recorded**, success or failure. A pipeline that can fail without leaving a
 * trace is a pipeline whose failures are discovered by a reader noticing a chart
 * stopped moving.
 */

const NOW = () => new Date("2026-08-26T12:00:00.000Z");

function harness(options: Parameters<typeof createCkanFetch>[0], seed: BoroughPermitStat[] = []) {
  const { fetchImpl, calls } = createCkanFetch(options);
  const db = createFakeCivicDb(seed);
  const importRuns = new InMemoryImportRunStore();
  return {
    db,
    importRuns,
    calls,
    dependencies: {
      connector: new MontrealOpenDataConnector({
        fetchImpl,
        baseUrl: "https://portal.test/api/3/action",
        pageSize: 1000,
      }),
      repository: new PostgresCivicDataRepository(db.executeSql),
      importRuns,
      now: NOW,
    },
  };
}

const rows = (count: number, borough = "Verdun", month = "05") =>
  Array.from({ length: count }, (_, i) =>
    permitRow({ borough, date: `2026-${month}-${String((i % 28) + 1).padStart(2, "0")}` }, i + 1),
  );

describe("a successful import", () => {
  it("discovers the resource, aggregates and writes", async () => {
    const { dependencies, db, calls } = harness({ records: rows(30) });

    const result = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);

    assert.equal(result.status, "success");
    assert.equal(result.recordsReceived, 30);
    assert.equal(result.recordsWritten, 1, "30 permits in one borough-month is one row");
    assert.equal(result.recordsRejected, 0);
    assert.equal(result.firstPeriod, "2026-05");
    assert.equal(db.rows.get("verdun:2026-05")?.permitsIssued, 30);

    // The resource id is discovered, not hard-coded: a package_show precedes
    // the datastore reads.
    assert.ok(calls[0].includes("package_show"));
    assert.equal(result.resourceId, "bbbbbbbb-2222-4000-8000-000000000002");
  });

  it("prefers the datastore-queryable resource over a PDF", async () => {
    const { dependencies } = harness({ records: rows(5) });
    const result = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);
    assert.equal(result.resourceId, "bbbbbbbb-2222-4000-8000-000000000002");
  });

  it("records a successful run in the audit trail", async () => {
    const { dependencies, importRuns } = harness({ records: rows(10) });
    await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);

    const runs = await importRuns.listRuns("src-montreal-permits");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "success");
    assert.equal(runs[0].completedAt !== null, true);

    const health = await importRuns.getHealth("src-montreal-permits");
    assert.equal(health.consecutiveFailures, 0);
    assert.ok(health.lastSuccessAt);
  });

  it("is idempotent — running it twice leaves the same rows", async () => {
    const { dependencies, db } = harness({ records: rows(30) });

    const first = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);
    const second = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);

    assert.equal(db.rows.size, 1);
    assert.equal(first.recordsWritten, second.recordsWritten);
    assert.equal(db.rows.get("verdun:2026-05")?.permitsIssued, 30);
  });

  it("honours a period window", async () => {
    const { dependencies, db } = harness({
      records: [...rows(5, "Verdun", "04"), ...rows(7, "Verdun", "05")],
    });

    const result = await ingestMontrealPermits(
      { dataset: MONTREAL_PERMITS, from: "2026-05", to: "2026-05" },
      dependencies,
    );

    assert.equal(result.recordsWritten, 1);
    assert.equal(db.rows.size, 1);
    assert.ok(db.rows.has("verdun:2026-05"));
  });
});

describe("partial imports", () => {
  it("writes the good rows, reports the bad ones, and records `partial`", async () => {
    const { dependencies, db, importRuns } = harness({
      records: [
        ...rows(10, "Verdun"),
        permitRow({ borough: "Laval", date: "2026-05-04" }, 100),
        permitRow({ borough: "Longueuil", date: "2026-05-05" }, 101),
      ],
    });

    const result = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);

    assert.equal(result.status, "partial");
    assert.equal(result.recordsWritten, 1);
    assert.equal(db.rows.get("verdun:2026-05")?.permitsIssued, 10);
    assert.deepEqual(result.unknownBoroughs, ["Laval", "Longueuil"]);
    assert.match(result.errorMessage ?? "", /2 source row\(s\) skipped/);

    const runs = await importRuns.listRuns("src-montreal-permits");
    assert.equal(runs[0].status, "partial");
  });

  it("counts a partial run as a success for freshness", async () => {
    // Data did land. It is still visible as partial in the run list.
    const { dependencies, importRuns } = harness({
      records: [...rows(5), permitRow({ borough: "Laval" }, 99)],
    });
    await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);

    const health = await importRuns.getHealth("src-montreal-permits");
    assert.equal(health.consecutiveFailures, 0);
    assert.ok(health.lastSuccessAt);
  });

  it("records an empty extract as partial, not failed", async () => {
    const { dependencies, importRuns } = harness({ records: [] });
    const result = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);

    assert.equal(result.status, "partial");
    assert.equal(result.errorKind, "empty-extract");
    assert.equal((await importRuns.listRuns("src-montreal-permits"))[0].status, "partial");
  });
});

describe("failures", () => {
  const expectFailure = async (
    dependencies: Parameters<typeof ingestMontrealPermits>[1],
    kind: string,
    matcher?: RegExp,
  ) => {
    await assert.rejects(
      () => ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies),
      (error: CivicIngestFailedError) => {
        assert.ok(error instanceof CivicIngestFailedError);
        assert.equal(error.result.errorKind, kind, `expected ${kind}, got ${error.result.errorKind}`);
        if (matcher) assert.match(error.message, matcher);
        return true;
      },
    );
  };

  it("fails and records a run when the portal is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const db = createFakeCivicDb();
    const importRuns = new InMemoryImportRunStore();

    await expectFailure(
      {
        connector: new MontrealOpenDataConnector({ fetchImpl, baseUrl: "https://portal.test/api/3/action" }),
        repository: new PostgresCivicDataRepository(db.executeSql),
        importRuns,
        now: NOW,
      },
      "network",
    );

    const runs = await importRuns.listRuns("src-montreal-permits");
    assert.equal(runs.length, 1, "a failed run is still recorded");
    assert.equal(runs[0].status, "failed");
  });

  it("fails on a 403 and explains that it is probably an egress policy", async () => {
    const { dependencies } = harness({ status: 403 });
    await expectFailure(dependencies, "http", /proxy, firewall or egress policy/);
  });

  it("fails with a schema mismatch when a required column is absent", async () => {
    // The scenario the field contract exists for. Without it, this import would
    // write a table of undefined boroughs and zero totals.
    const { dependencies, db } = harness({
      records: [{ _id: 1, secteur: "Verdun", jour: "2026-05-04" }],
      fields: [
        { id: "_id", type: "int4" },
        { id: "secteur", type: "text" },
        { id: "jour", type: "text" },
      ],
    });

    await expectFailure(dependencies, "schema-mismatch", /Columns actually present: _id, secteur, jour/);
    assert.equal(db.rows.size, 0, "nothing was written");
  });

  it("fails when the dataset has no queryable resource", async () => {
    const { dependencies } = harness({
      records: rows(5),
      pkg: packageResponse({
        resources: [
          { id: "r1", name: "PDF", format: "PDF", datastore_active: false, last_modified: null },
        ],
      }),
    });
    await expectFailure(dependencies, "no-queryable-resource", /no datastore-queryable resource/);
  });

  it("fails when every row is unusable", async () => {
    const { dependencies } = harness({
      records: [
        permitRow({ borough: "Laval" }, 1),
        permitRow({ borough: "Longueuil" }, 2),
      ],
    });
    await expectFailure(dependencies, "no-usable-rows");
  });

  it("fails on a batch anomaly and writes nothing", async () => {
    // Rows dated in the future — the signature of a misread date column.
    const { dependencies, db } = harness({
      records: [
        permitRow({ borough: "Verdun", date: "2031-02-01" }, 1),
        permitRow({ borough: "Verdun", date: "2031-03-01" }, 2),
      ],
    });

    await expectFailure(dependencies, "batch-anomaly", /cannot be issued in the future/);
    assert.equal(db.rows.size, 0);
  });

  it("fails loudly when the store refuses the write", async () => {
    const { fetchImpl } = createCkanFetch({ records: rows(5) });
    const importRuns = new InMemoryImportRunStore();

    await expectFailure(
      {
        connector: new MontrealOpenDataConnector({ fetchImpl, baseUrl: "https://portal.test/api/3/action" }),
        // The demo repository refuses writes rather than accepting them into
        // memory that vanishes on restart.
        repository: new DemoCivicDataRepository(),
        importRuns,
        now: NOW,
      },
      "persistence",
      /read-only/,
    );

    const health = await importRuns.getHealth("src-montreal-permits");
    assert.equal(health.consecutiveFailures, 1);
    assert.equal(health.lastFailureKind, "persistence");
  });

  it("never leaks a stack trace into the reported message", async () => {
    const { dependencies } = harness({ status: 500 });
    await assert.rejects(
      () => ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies),
      (error: CivicIngestFailedError) => {
        assert.ok(!error.message.includes("    at "), error.message);
        return true;
      },
    );
  });
});

/**
 * The requirement stated plainly: an invalid import must not be able to quietly
 * replace good history.
 *
 * Three ways an import can go wrong, each checked against a store that already
 * holds correct data.
 */
describe("an invalid import cannot overwrite good historical data", () => {
  const existing = (): BoroughPermitStat[] => [
    {
      boroughCode: "verdun",
      period: "2026-04",
      permitsIssued: 88,
      dwellingUnitsCreated: 9,
      declaredWorkValue: 3_100_000,
      byCategory: { "new-construction": 6, renovation: 76, demolition: 2, other: 4 },
      dataSourceId: "src-montreal-permits",
      retrievedAt: "2026-05-02T12:00:00.000Z",
      dataQuality: "live",
    },
    {
      boroughCode: "outremont",
      period: "2026-04",
      permitsIssued: 41,
      dwellingUnitsCreated: 3,
      declaredWorkValue: 1_200_000,
      byCategory: { "new-construction": 2, renovation: 37, demolition: 1, other: 1 },
      dataSourceId: "src-montreal-permits",
      retrievedAt: "2026-05-02T12:00:00.000Z",
      dataQuality: "live",
    },
  ];

  const assertHistoryIntact = (db: ReturnType<typeof createFakeCivicDb>) => {
    assert.equal(db.rows.size, 2, "both historical rows survive");
    assert.equal(db.rows.get("verdun:2026-04")?.permitsIssued, 88);
    assert.equal(db.rows.get("outremont:2026-04")?.permitsIssued, 41);
    assert.equal(db.deleteCalls, 0, "no DELETE was ever attempted");
  };

  it("survives a schema mismatch", async () => {
    const { dependencies, db } = harness(
      {
        records: [{ _id: 1, secteur: "Verdun", jour: "2026-05-04" }],
        fields: [
          { id: "_id", type: "int4" },
          { id: "secteur", type: "text" },
          { id: "jour", type: "text" },
        ],
      },
      existing(),
    );

    await assert.rejects(() =>
      ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies),
    );
    assertHistoryIntact(db);
  });

  it("survives a batch of corrupted future dates", async () => {
    const { dependencies, db } = harness(
      { records: [permitRow({ borough: "Verdun", date: "2031-02-01" }, 1)] },
      existing(),
    );

    await assert.rejects(() =>
      ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies),
    );
    assertHistoryIntact(db);
  });

  it("survives an empty extract", async () => {
    // The most dangerous case: an import that "succeeds" with nothing in it.
    // A pipeline that treated absence as deletion would erase everything here.
    const { dependencies, db } = harness({ records: [] }, existing());

    const result = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);
    assert.equal(result.status, "partial");
    assertHistoryIntact(db);
  });

  it("survives an import covering only some of the boroughs on record", async () => {
    const { dependencies, db } = harness(
      { records: rows(12, "Verdun", "04") },
      existing(),
    );

    const result = await ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies);

    assert.equal(result.status, "success");
    assert.equal(db.rows.size, 2, "Outremont was not mentioned and was not removed");
    assert.equal(db.rows.get("verdun:2026-04")?.permitsIssued, 12, "Verdun was revised");
    assert.equal(db.rows.get("outremont:2026-04")?.permitsIssued, 41, "Outremont untouched");
    assert.equal(db.deleteCalls, 0);
  });

  it("survives an upstream outage", async () => {
    const { dependencies, db } = harness({ status: 503 }, existing());
    await assert.rejects(() =>
      ingestMontrealPermits({ dataset: MONTREAL_PERMITS }, dependencies),
    );
    assertHistoryIntact(db);
  });
});

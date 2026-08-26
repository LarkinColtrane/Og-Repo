import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BankOfCanadaConnector } from "@/lib/pipeline/connectors/bank-of-canada/client";
import {
  IngestFailedError,
  ingestBankOfCanadaSeries,
} from "@/lib/pipeline/ingest/bank-of-canada";
import { PostgresMarketBenchmarkRepository } from "@/lib/data/postgres-benchmark-repository";
import { DemoMarketBenchmarkRepository } from "@/lib/data/demo-benchmark-repository";
import { InMemoryImportRunStore } from "@/lib/data/import-run-store";
import { createFakeDb } from "./fixtures/fake-sql";
import { jsonResponse, valetFiveYearFixture } from "./fixtures/valet";

function harness(fetchImpl: typeof fetch) {
  const db = createFakeDb();
  return {
    db,
    deps: {
      connector: new BankOfCanadaConnector({ fetchImpl }),
      repository: new PostgresMarketBenchmarkRepository(db.executeSql),
      importRuns: new InMemoryImportRunStore(),
    },
  };
}

describe("ingestBankOfCanadaSeries", () => {
  it("runs the full pipeline and records a success", async () => {
    const { db, deps } = harness(async () => jsonResponse(valetFiveYearFixture));

    const result = await ingestBankOfCanadaSeries(
      { seriesCode: "5y-canada-bond", startDate: "2026-04-01", endDate: "2026-04-07" },
      deps,
    );

    assert.equal(result.status, "success");
    assert.equal(result.recordsReceived, 5);
    assert.equal(result.recordsWritten, 4);
    assert.equal(result.recordsSkipped, 1, "Good Friday is skipped, not rejected");
    assert.equal(result.recordsRejected, 0);
    assert.equal(result.firstObservationDate, "2026-04-01");
    assert.equal(result.lastObservationDate, "2026-04-07");
    assert.equal(db.rows.size, 4);

    const health = await deps.importRuns.getHealth("src-boc-valet");
    assert.ok(health.lastSuccessAt);
    assert.equal(health.consecutiveFailures, 0);
    assert.equal(health.lastSuccessRecordsWritten, 4);
  });

  it("requests the documented Valet URL", async () => {
    let requested = "";
    const { deps } = harness(async (url) => {
      requested = String(url);
      return jsonResponse(valetFiveYearFixture);
    });
    await ingestBankOfCanadaSeries(
      { seriesCode: "5y-canada-bond", startDate: "2021-01-01", endDate: "2026-06-30" },
      deps,
    );
    assert.equal(
      requested,
      "https://www.bankofcanada.ca/valet/observations/BD.CDN.5YR.DQ.YLD/json" +
        "?start_date=2021-01-01&end_date=2026-06-30",
    );
  });

  it("is idempotent — re-running the same range does not duplicate rows", async () => {
    const { db, deps } = harness(async () => jsonResponse(valetFiveYearFixture));
    const options = { seriesCode: "5y-canada-bond" as const, startDate: "2026-04-01", endDate: "2026-04-07" };

    await ingestBankOfCanadaSeries(options, deps);
    await ingestBankOfCanadaSeries(options, deps);

    assert.equal(db.rows.size, 4);
    assert.equal((await deps.importRuns.listRuns("src-boc-valet")).length, 2, "both runs recorded");
  });

  it("records a failed run when the network is unreachable", async () => {
    const { db, deps } = harness(async () => {
      throw new TypeError("fetch failed");
    });

    await assert.rejects(
      () => ingestBankOfCanadaSeries({ seriesCode: "5y-canada-bond", recent: 5 }, deps),
      (error: unknown) => {
        assert.ok(error instanceof IngestFailedError);
        assert.equal(error.result.status, "failed");
        assert.equal(error.result.errorKind, "network");
        return true;
      },
    );

    assert.equal(db.rows.size, 0, "nothing written on failure");
    const health = await deps.importRuns.getHealth("src-boc-valet");
    assert.equal(health.consecutiveFailures, 1);
    assert.match(health.lastFailureMessage!, /Could not reach the Bank of Canada/);
    assert.equal(health.lastFailureKind, "network");
  });

  it("records a failed run when upstream returns a malformed body", async () => {
    const { deps } = harness(async () => jsonResponse({ message: "nope" }));
    await assert.rejects(
      () => ingestBankOfCanadaSeries({ seriesCode: "5y-canada-bond", recent: 5 }, deps),
      (error: unknown) => {
        assert.ok(error instanceof IngestFailedError);
        assert.equal(error.result.errorKind, "malformed");
        return true;
      },
    );
    const health = await deps.importRuns.getHealth("src-boc-valet");
    assert.equal(health.consecutiveFailures, 1);
  });

  it("records a failed run on an HTTP error", async () => {
    const { deps } = harness(async () => jsonResponse({ message: "Series not found" }, 404));
    await assert.rejects(
      () => ingestBankOfCanadaSeries({ seriesCode: "5y-canada-bond", recent: 5 }, deps),
      (error: unknown) => {
        assert.ok(error instanceof IngestFailedError);
        assert.equal(error.result.errorKind, "http");
        return true;
      },
    );
  });

  it("marks a batch partial when some rows fail validation, and writes the rest", async () => {
    const { db, deps } = harness(async () =>
      jsonResponse({
        observations: [
          { d: "2026-04-01", "BD.CDN.5YR.DQ.YLD": { v: "3.18" } },
          { d: "2026-02-31", "BD.CDN.5YR.DQ.YLD": { v: "3.20" } }, // impossible date
          { d: "2026-04-06", "BD.CDN.5YR.DQ.YLD": { v: "999" } },  // impossible yield
          { d: "2026-04-07", "BD.CDN.5YR.DQ.YLD": { v: "3.21" } },
        ],
      }),
    );

    const result = await ingestBankOfCanadaSeries(
      { seriesCode: "5y-canada-bond", startDate: "2026-04-01", endDate: "2026-04-07" },
      deps,
    );

    assert.equal(result.status, "partial", "a partly rejected batch is not a success");
    assert.equal(result.recordsWritten, 2);
    assert.equal(result.recordsRejected, 2);
    assert.equal(db.rows.size, 2);
    assert.match(result.errorMessage!, /failed validation/);
  });

  it("fails rather than writing anything when the whole batch is invalid", async () => {
    const { db, deps } = harness(async () =>
      jsonResponse({
        observations: [
          { d: "2026-04-01", "BD.CDN.5YR.DQ.YLD": { v: "-99" } },
          { d: "2026-04-02", "BD.CDN.5YR.DQ.YLD": { v: "-98" } },
        ],
      }),
    );
    await assert.rejects(
      () => ingestBankOfCanadaSeries({ seriesCode: "5y-canada-bond", recent: 2 }, deps),
      (error: unknown) => {
        assert.ok(error instanceof IngestFailedError);
        assert.equal(error.result.errorKind, "validation");
        return true;
      },
    );
    assert.equal(db.rows.size, 0);
  });

  it("refuses a batch that switched from percent to fractions", async () => {
    const { db, deps } = harness(async () =>
      jsonResponse({
        observations: Array.from({ length: 40 }, (_unused, i) => ({
          d: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`,
          "BD.CDN.5YR.DQ.YLD": { v: "0.0321" },
        })).filter((row, i, all) => all.findIndex((r) => r.d === row.d) === i),
      }),
    );

    // 28 unique dates clears the minimum sample; all sit below the plausible band.
    await assert.rejects(
      () => ingestBankOfCanadaSeries({ seriesCode: "5y-canada-bond", recent: 40 }, deps),
      (error: unknown) => {
        assert.ok(error instanceof IngestFailedError);
        assert.equal(error.result.errorKind, "unit-anomaly");
        assert.match(error.result.errorMessage!, /fractions instead of percent/);
        return true;
      },
    );
    assert.equal(db.rows.size, 0, "a unit error must never reach storage");
  });

  it("reports an empty range as partial rather than a success", async () => {
    const { deps } = harness(async () => jsonResponse({ observations: [] }));
    const result = await ingestBankOfCanadaSeries(
      { seriesCode: "5y-canada-bond", startDate: "2026-12-25", endDate: "2026-12-25" },
      deps,
    );
    assert.equal(result.status, "partial");
    assert.equal(result.errorKind, "empty-range");
    assert.equal(result.recordsWritten, 0);
  });

  it("records a failed run when persistence rejects the write", async () => {
    const { db, deps } = harness(async () => jsonResponse(valetFiveYearFixture));
    db.failNext("connection terminated unexpectedly");

    await assert.rejects(
      () => ingestBankOfCanadaSeries({ seriesCode: "5y-canada-bond", recent: 5 }, deps),
      (error: unknown) => {
        assert.ok(error instanceof IngestFailedError);
        assert.equal(error.result.errorKind, "persistence");
        return true;
      },
    );
    const health = await deps.importRuns.getHealth("src-boc-valet");
    assert.equal(health.consecutiveFailures, 1);
  });

  it("fails loudly against the read-only demo store instead of pretending to write", async () => {
    const deps = {
      connector: new BankOfCanadaConnector({
        fetchImpl: async () => jsonResponse(valetFiveYearFixture),
      }),
      repository: new DemoMarketBenchmarkRepository(),
      importRuns: new InMemoryImportRunStore(),
    };
    await assert.rejects(
      () => ingestBankOfCanadaSeries({ seriesCode: "5y-canada-bond", recent: 5 }, deps),
      (error: unknown) => {
        assert.ok(error instanceof IngestFailedError);
        assert.equal(error.result.errorKind, "persistence");
        assert.match(error.result.errorMessage!, /read-only/);
        return true;
      },
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PostgresImportRunStore,
  PostgresMarketBenchmarkRepository,
} from "@/lib/data/postgres-benchmark-repository";
import { DemoMarketBenchmarkRepository } from "@/lib/data/demo-benchmark-repository";
import { BenchmarkWriteNotSupportedError } from "@/lib/data/benchmark-repository";
import { InMemoryImportRunStore } from "@/lib/data/import-run-store";
import type { BenchmarkObservation } from "@/types/benchmark";
import { createFakeDb } from "./fixtures/fake-sql";

const observation = (date: string, value: number): BenchmarkObservation => ({
  seriesCode: "5y-canada-bond",
  observationDate: date,
  value,
  source: "src-boc-valet",
  retrievedAt: "2026-06-15T09:00:00.000Z",
  dataQuality: "live",
});

describe("PostgresMarketBenchmarkRepository", () => {
  it("inserts new observations", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);
    const written = await repo.upsertObservations([
      observation("2026-04-01", 3.18),
      observation("2026-04-02", 3.2),
    ]);
    assert.equal(written, 2);
    assert.equal(db.rows.size, 2);
  });

  it("updates rather than duplicating on the same series and date", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);

    await repo.upsertObservations([observation("2026-04-01", 3.18)]);
    await repo.upsertObservations([observation("2026-04-01", 3.44)]); // corrected

    assert.equal(db.rows.size, 1, "no duplicate row for the same date");
    assert.equal(db.rows.get("5y-canada-bond:2026-04-01")?.value, 3.44);
  });

  it("is idempotent across a repeated range", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);
    const batch = [
      observation("2026-04-01", 3.18),
      observation("2026-04-02", 3.2),
      observation("2026-04-06", 3.24),
    ];

    await repo.upsertObservations(batch);
    await repo.upsertObservations(batch);
    await repo.upsertObservations(batch);

    assert.equal(db.rows.size, 3, "re-running the same range must not add rows");
  });

  it("preserves history across many dates", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);
    await repo.upsertObservations([
      observation("2021-06-01", 0.95),
      observation("2023-06-01", 3.4),
      observation("2026-04-01", 3.18),
    ]);

    const all = await repo.getHistory({ seriesCode: "5y-canada-bond" });
    assert.equal(all.length, 3);
    // The point of keeping history: a value can be recovered for a given date.
    assert.equal(all.find((o) => o.observationDate === "2021-06-01")?.value, 0.95);
  });

  it("returns the latest observation", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);
    await repo.upsertObservations([
      observation("2026-04-01", 3.18),
      observation("2026-04-07", 3.21),
      observation("2026-04-02", 3.2),
    ]);
    const latest = await repo.getLatest("5y-canada-bond");
    assert.equal(latest?.observationDate, "2026-04-07");
    assert.equal(latest?.value, 3.21);
  });

  it("returns the observation before a given date", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);
    await repo.upsertObservations([
      observation("2026-04-01", 3.18),
      observation("2026-04-02", 3.2),
    ]);
    const previous = await repo.getPrevious("5y-canada-bond", "2026-04-02");
    assert.equal(previous?.observationDate, "2026-04-01");
  });

  it("filters history by date range", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);
    await repo.upsertObservations([
      observation("2026-01-05", 3.0),
      observation("2026-04-01", 3.18),
      observation("2026-06-01", 3.3),
    ]);

    const window = await repo.getHistory({
      seriesCode: "5y-canada-bond",
      startDate: "2026-03-01",
      endDate: "2026-05-01",
    });
    assert.deepEqual(window.map((o) => o.observationDate), ["2026-04-01"]);
  });

  it("writes nothing for an empty batch without touching the database", async () => {
    const db = createFakeDb();
    const repo = new PostgresMarketBenchmarkRepository(db.executeSql);
    assert.equal(await repo.upsertObservations([]), 0);
    assert.equal(db.queries.length, 0);
  });
});

describe("DemoMarketBenchmarkRepository", () => {
  it("refuses writes rather than silently accepting them", async () => {
    const repo = new DemoMarketBenchmarkRepository();
    await assert.rejects(
      () => repo.upsertObservations([observation("2026-04-01", 3.18)]),
      BenchmarkWriteNotSupportedError,
    );
  });

  it("serves a generated series marked as demo", async () => {
    const repo = new DemoMarketBenchmarkRepository();
    assert.equal(repo.dataQuality, "demo");
    const latest = await repo.getLatest("5y-canada-bond");
    assert.ok(latest);
    assert.equal(latest!.dataQuality, "demo");
    // Never attributed to the Bank of Canada — these numbers are invented.
    assert.equal(latest!.source, "src-demo-benchmarks");
  });

  it("generates business days only, with no weekend observations", async () => {
    const repo = new DemoMarketBenchmarkRepository();
    const history = await repo.getHistory({ seriesCode: "5y-canada-bond" });
    assert.ok(history.length > 1000, `expected ~5y of business days, got ${history.length}`);

    const weekend = history.filter((o) => {
      const day = new Date(`${o.observationDate}T00:00:00Z`).getUTCDay();
      return day === 0 || day === 6;
    });
    assert.equal(weekend.length, 0, "demo series must not contain weekend observations");
  });
});

describe("import run store", () => {
  it("records a run from start to completion", async () => {
    const store = new InMemoryImportRunStore();
    const runId = await store.startRun({ dataSourceId: "src-boc-valet", triggeredBy: "manual" });

    let runs = await store.listRuns("src-boc-valet");
    assert.equal(runs[0].status, "running");
    assert.equal(runs[0].completedAt, null);

    await store.completeRun(runId, {
      status: "success",
      recordsReceived: 100,
      recordsWritten: 98,
      recordsRejected: 0,
    });

    runs = await store.listRuns("src-boc-valet");
    assert.equal(runs[0].status, "success");
    assert.equal(runs[0].recordsImported, 98);
    assert.ok(runs[0].completedAt);
  });

  it("summarises health, counting consecutive failures", async () => {
    const store = new InMemoryImportRunStore();

    const ok = await store.startRun({ dataSourceId: "s", triggeredBy: "schedule" });
    await store.completeRun(ok, { status: "success", recordsReceived: 10, recordsWritten: 10, recordsRejected: 0 });

    for (const message of ["boom one", "boom two"]) {
      const bad = await store.startRun({ dataSourceId: "s", triggeredBy: "schedule" });
      await store.completeRun(bad, {
        status: "failed",
        recordsReceived: 0,
        recordsWritten: 0,
        recordsRejected: 0,
        errorMessage: message,
        errorKind: "network",
      });
    }

    const health = await store.getHealth("s");
    assert.equal(health.consecutiveFailures, 2);
    assert.equal(health.lastFailureMessage, "boom two");
    assert.equal(health.lastFailureKind, "network");
    assert.ok(health.lastSuccessAt, "the earlier success is still recorded");
    assert.equal(health.lastSuccessRecordsWritten, 10);
    assert.equal(health.totalRuns, 3);
  });

  it("treats a partial run as a success for freshness", async () => {
    const store = new InMemoryImportRunStore();
    const id = await store.startRun({ dataSourceId: "s", triggeredBy: "manual" });
    await store.completeRun(id, {
      status: "partial",
      recordsReceived: 10,
      recordsWritten: 9,
      recordsRejected: 1,
    });
    const health = await store.getHealth("s");
    assert.ok(health.lastSuccessAt, "data did land, so freshness advances");
    assert.equal(health.consecutiveFailures, 0);
  });
});

describe("PostgresImportRunStore", () => {
  it("opens and closes a run through SQL", async () => {
    const db = createFakeDb();
    const store = new PostgresImportRunStore(db.executeSql);
    const runId = await store.startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
    await store.completeRun(runId, {
      status: "success",
      recordsReceived: 1250,
      recordsWritten: 1250,
      recordsRejected: 0,
    });
    assert.equal(db.runs[0].status, "success");
    assert.equal(db.runs[0].records_imported, 1250);
  });
});

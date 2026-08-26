import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { PostgresMarketBenchmarkRepository, PostgresImportRunStore } from "@/lib/data/postgres-benchmark-repository";
import { PostgresCivicDataRepository } from "@/lib/data/postgres-civic-repository";
import { PostgresMortgageRateRepository } from "@/lib/data/postgres-mortgage-repository";
import { PostgresMarketDataRepository } from "@/lib/data/postgres-repository";
import { PostgresAlertIncidentStore } from "@/lib/data/postgres-alert-store";
import { closePool } from "@/lib/data/postgres-client";
import { evaluatePipelineAlerts } from "@/lib/pipeline/alerts";
import { assessPipelineHealth } from "@/lib/pipeline/health";
import type { BenchmarkObservation } from "@/types/benchmark";
import type { BoroughPermitStat } from "@/types/civic";
import {
  assertSchema,
  describeIfDb,
  sql,
  truncateAll,
  withFreshConnection,
} from "./helper";

/**
 * Every one of these runs against a real PostgreSQL server.
 *
 * Phase 4's unit tests used a fake executor that has no types, no CHECK
 * constraints and no foreign keys. It passed while the real SQL was broken in
 * four separate places — three enum/text mismatches and a foreign key with no
 * rows to point at. This file is the layer that would have caught them.
 */

const { skip, reason } = describeIfDb();

const observation = (
  observationDate: string,
  value: number,
  overrides: Partial<BenchmarkObservation> = {},
): BenchmarkObservation => ({
  seriesCode: "5y-canada-bond",
  observationDate,
  value,
  source: "src-boc-valet",
  retrievedAt: "2026-08-26T12:00:00.000Z",
  dataQuality: "live",
  ...overrides,
});

const permitStat = (
  boroughCode: string,
  period: string,
  overrides: Partial<BoroughPermitStat> = {},
): BoroughPermitStat => ({
  boroughCode,
  period,
  permitsIssued: 100,
  dwellingUnitsCreated: 12,
  declaredWorkValue: 4_500_000,
  byCategory: { "new-construction": 8, renovation: 85, demolition: 3, other: 4 },
  dataSourceId: "src-montreal-permits",
  retrievedAt: "2026-08-26T12:00:00.000Z",
  dataQuality: "live",
  ...overrides,
});

before(async () => {
  // `before` gets a SuiteContext, which has no `skip`. Each test skips itself.
  if (skip) {
    console.log(`# ${reason}`);
    return;
  }
  await assertSchema();
});

beforeEach(async () => {
  if (!skip) await truncateAll();
});

after(async () => {
  if (!skip) await closePool();
});

/* ── Benchmarks ───────────────────────────────────────────────────────────── */

describe("PostgresMarketBenchmarkRepository against real PostgreSQL", () => {
  const repo = () => new PostgresMarketBenchmarkRepository(sql());

  it("inserts and reads back an observation", async (t) => {
    if (skip) return t.skip(reason);
    const written = await repo().upsertObservations([observation("2026-08-25", 3.23)]);
    assert.equal(written, 1);

    const latest = await repo().getLatest("5y-canada-bond");
    assert.equal(latest?.observationDate, "2026-08-25");
    assert.equal(latest?.value, 3.23, "numeric round-trips as a number, not a string");
    assert.equal(latest?.dataQuality, "live");
  });

  it("accepts the data_quality ENUM", async (t) => {
    if (skip) return t.skip(reason);
    // The bug this catches: `unnest($6::text[])` into a column of type
    // benchmark_data_quality raises "column is of type benchmark_data_quality
    // but expression is of type text". A fake executor has no types.
    await repo().upsertObservations([
      observation("2026-08-24", 3.2, { dataQuality: "live" }),
      observation("2026-08-21", 3.19, { dataQuality: "demo" }),
    ]);
    const history = await repo().getHistory({ seriesCode: "5y-canada-bond" });
    assert.deepEqual(history.map((row) => row.dataQuality).sort(), ["demo", "live"]);
  });

  /**
   * The requirement, stated literally:
   *
   *   Import observation A  → database = 1 row
   *   Import observation A again → database must still = 1 row
   */
  it("is IDEMPOTENT — importing the same observation twice leaves one row", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertObservations([observation("2026-08-25", 3.23)]);
    const [afterFirst] = await sql()<{ count: string }>(
      `SELECT count(*)::text AS count FROM market_benchmarks`,
    );
    assert.equal(afterFirst.count, "1");

    await repo().upsertObservations([observation("2026-08-25", 3.23)]);
    const [afterSecond] = await sql()<{ count: string }>(
      `SELECT count(*)::text AS count FROM market_benchmarks`,
    );
    assert.equal(afterSecond.count, "1", "the natural key prevented a duplicate");
  });

  it("updates a revised value in place rather than appending", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertObservations([observation("2026-08-25", 3.23)]);
    await repo().upsertObservations([observation("2026-08-25", 3.27)]);

    const history = await repo().getHistory({ seriesCode: "5y-canada-bond" });
    assert.equal(history.length, 1);
    assert.equal(history[0].value, 3.27, "the newer value won");
  });

  it("re-importing a whole overlapping window does not double the series", async (t) => {
    if (skip) return t.skip(reason);
    // Exactly what the scheduler does every run: `recent: 10` re-fetches days
    // it has already stored.
    const window = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
    const batch = window.map((date, i) => observation(date, 3.1 + i * 0.01));

    await repo().upsertObservations(batch);
    await repo().upsertObservations(batch);
    await repo().upsertObservations(batch);

    const history = await repo().getHistory({ seriesCode: "5y-canada-bond" });
    assert.equal(history.length, 5, "three identical imports, five rows");
  });

  it("filters history by date range, ascending", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertObservations([
      observation("2026-06-01", 3.0),
      observation("2026-07-01", 3.1),
      observation("2026-08-01", 3.2),
    ]);

    const range = await repo().getHistory({
      seriesCode: "5y-canada-bond",
      startDate: "2026-06-15",
      endDate: "2026-08-15",
    });
    assert.deepEqual(range.map((r) => r.observationDate), ["2026-07-01", "2026-08-01"]);
  });

  it("a limit returns the most recent observations, not the oldest", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertObservations([
      observation("2026-06-01", 3.0),
      observation("2026-07-01", 3.1),
      observation("2026-08-01", 3.2),
    ]);
    const recent = await repo().getHistory({ seriesCode: "5y-canada-bond", limit: 2 });
    assert.deepEqual(recent.map((r) => r.observationDate), ["2026-07-01", "2026-08-01"]);
  });

  it("getPrevious finds the observation before a date", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertObservations([
      observation("2026-08-21", 3.19),
      observation("2026-08-25", 3.23),
    ]);
    const previous = await repo().getPrevious("5y-canada-bond", "2026-08-25");
    assert.equal(previous?.observationDate, "2026-08-21");
  });

  it("keeps series separate", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertObservations([
      observation("2026-08-25", 3.23),
      observation("2026-08-25", 3.51, { seriesCode: "10y-canada-bond" }),
    ]);
    assert.equal((await repo().getLatest("5y-canada-bond"))?.value, 3.23);
    assert.equal((await repo().getLatest("10y-canada-bond"))?.value, 3.51);
  });

  it("the CHECK constraint rejects an impossible yield", async (t) => {
    if (skip) return t.skip(reason);
    // The database is the last line of defence behind the Zod schema. A fake
    // executor has no CHECK constraints, so this could never have been proven.
    await assert.rejects(
      () => repo().upsertObservations([observation("2026-08-25", 999)]),
      /violates check constraint/,
    );
  });
});

/* ── Import runs ──────────────────────────────────────────────────────────── */

describe("PostgresImportRunStore against real PostgreSQL", () => {
  const store = () => new PostgresImportRunStore(sql());

  it("records a successful run", async (t) => {
    if (skip) return t.skip(reason);
    const runId = await store().startRun({
      dataSourceId: "src-boc-valet",
      triggeredBy: "schedule",
      metadata: { requestUrl: "https://example.test/valet" },
    });
    await store().completeRun(runId, {
      status: "success",
      recordsReceived: 10,
      recordsWritten: 10,
      recordsRejected: 0,
    });

    const runs = await store().listRuns("src-boc-valet");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "success");
    assert.equal(runs[0].recordsImported, 10);
    assert.ok(runs[0].completedAt, "the run was closed");
  });

  it("satisfies the foreign key to data_sources", async (t) => {
    if (skip) return t.skip(reason);
    // The bug this catches: import_runs.data_source_id references
    // data_sources(id), and only two of the fourteen sources were ever seeded.
    // startRun() therefore failed on a real database before making a single
    // outbound request. Migration 006 seeds the registry.
    for (const source of ["src-boc-valet", "src-montreal-permits", "src-demo-sales"]) {
      const runId = await store().startRun({ dataSourceId: source, triggeredBy: "manual" });
      assert.ok(runId, source);
    }
  });

  it("rejects a run for a source that does not exist", async (t) => {
    if (skip) return t.skip(reason);
    await assert.rejects(
      () => store().startRun({ dataSourceId: "src-not-real", triggeredBy: "manual" }),
      /violates foreign key constraint/,
    );
  });

  it("records a failure with its kind and message", async (t) => {
    if (skip) return t.skip(reason);
    const runId = await store().startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
    await store().completeRun(runId, {
      status: "failed",
      recordsReceived: 0,
      recordsWritten: 0,
      recordsRejected: 0,
      errorMessage: "Bank of Canada API returned 503.",
      errorKind: "http",
    });

    const health = await store().getHealth("src-boc-valet");
    assert.equal(health.consecutiveFailures, 1);
    assert.equal(health.lastFailureKind, "http");
    assert.match(health.lastFailureMessage ?? "", /503/);
  });

  it("records a partial run and counts it as a success for freshness", async (t) => {
    if (skip) return t.skip(reason);
    const runId = await store().startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
    await store().completeRun(runId, {
      status: "partial",
      recordsReceived: 10,
      recordsWritten: 8,
      recordsRejected: 2,
      errorMessage: "2 rejected",
      errorKind: "partial-validation",
    });

    const health = await store().getHealth("src-boc-valet");
    assert.equal(health.consecutiveFailures, 0, "data landed");
    assert.ok(health.lastSuccessAt);
  });

  it("counts consecutive failures and resets on success", async (t) => {
    if (skip) return t.skip(reason);
    const fail = async () => {
      const id = await store().startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
      await store().completeRun(id, {
        status: "failed", recordsReceived: 0, recordsWritten: 0, recordsRejected: 0,
        errorMessage: "down", errorKind: "http",
      });
    };
    await fail();
    await fail();
    assert.equal((await store().getHealth("src-boc-valet")).consecutiveFailures, 2);

    const id = await store().startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
    await store().completeRun(id, {
      status: "success", recordsReceived: 5, recordsWritten: 5, recordsRejected: 0,
    });
    assert.equal((await store().getHealth("src-boc-valet")).consecutiveFailures, 0);
  });

  it("persists received / written / rejected counts and the error kind", async (t) => {
    if (skip) return t.skip(reason);
    const runId = await store().startRun({ dataSourceId: "src-montreal-permits", triggeredBy: "manual" });
    await store().completeRun(runId, {
      status: "partial",
      recordsReceived: 4137,
      recordsWritten: 19,
      recordsRejected: 62,
      errorMessage: "62 source rows skipped",
      errorKind: "partial-validation",
    });

    const [row] = await sql()<Record<string, unknown>>(
      `SELECT records_received, records_imported, records_rejected, error_kind, status,
              started_at, completed_at, data_source_id
         FROM import_runs WHERE id = $1::bigint`,
      [runId],
    );
    assert.equal(Number(row.records_received), 4137);
    assert.equal(Number(row.records_imported), 19);
    assert.equal(Number(row.records_rejected), 62);
    assert.equal(row.error_kind, "partial-validation");
    assert.equal(row.status, "partial");
    assert.equal(row.data_source_id, "src-montreal-permits");
    assert.ok(row.started_at && row.completed_at);
  });

  /** §6: operational history must survive a restart. */
  it("history survives a connection the writer knows nothing about", async (t) => {
    if (skip) return t.skip(reason);
    const runId = await store().startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
    await store().completeRun(runId, {
      status: "success", recordsReceived: 7, recordsWritten: 7, recordsRejected: 0,
    });

    // A brand-new connection, no shared pool — the closest a test gets to a
    // process restart.
    const rows = await withFreshConnection((query) =>
      query<{ count: string }>(`SELECT count(*)::text AS count FROM import_runs`),
    );
    assert.equal(rows[0].count, "1", "the audit trail is durable, not in-memory");
  });
});

/* ── Civic permits ────────────────────────────────────────────────────────── */

describe("PostgresCivicDataRepository against real PostgreSQL", () => {
  const repo = () => new PostgresCivicDataRepository(sql());

  it("inserts and reads back a borough-month", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertPermitStats([permitStat("verdun", "2026-05")]);
    const [row] = await repo().getPermitStats({ boroughCode: "verdun" });

    assert.equal(row.permitsIssued, 100);
    assert.equal(typeof row.declaredWorkValue, "number", "numeric came back as a number");
    assert.equal(row.byCategory.renovation, 85, "jsonb round-tripped");
  });

  it("accepts the civic data_quality ENUM", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertPermitStats([
      permitStat("verdun", "2026-05", { dataQuality: "live" }),
      permitStat("anjou", "2026-05", { dataQuality: "demo" }),
    ]);
    const rows = await repo().getPermitStats({ from: "2026-05", to: "2026-05" });
    assert.deepEqual(rows.map((r) => r.dataQuality).sort(), ["demo", "live"]);
  });

  it("is IDEMPOTENT on (borough, period)", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertPermitStats([permitStat("verdun", "2026-05")]);
    await repo().upsertPermitStats([permitStat("verdun", "2026-05")]);

    const [row] = await sql()<{ count: string }>(
      `SELECT count(*)::text AS count FROM civic_permit_stats`,
    );
    assert.equal(row.count, "1");
  });

  it("enforces the foreign key to civic_geography", async (t) => {
    if (skip) return t.skip(reason);
    // A borough code the registry does not know cannot reach storage, even if
    // the application layer somehow let it through.
    await assert.rejects(
      () => repo().upsertPermitStats([permitStat("laval", "2026-05")]),
      /violates foreign key constraint/,
    );
  });

  it("preserves NULL unit counts rather than turning them into zero", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertPermitStats([
      permitStat("verdun", "2026-05", { dwellingUnitsCreated: null, declaredWorkValue: null }),
    ]);
    const [row] = await repo().getPermitStats({ boroughCode: "verdun" });
    assert.equal(row.dwellingUnitsCreated, null);
    assert.equal(row.declaredWorkValue, null);
  });

  it("NEVER deletes a borough a later import does not mention", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertPermitStats([
      permitStat("verdun", "2026-05", { permitsIssued: 90 }),
      permitStat("outremont", "2026-05", { permitsIssued: 40 }),
    ]);
    await repo().upsertPermitStats([permitStat("verdun", "2026-05", { permitsIssued: 92 })]);

    const rows = await repo().getPermitStats({ from: "2026-05", to: "2026-05" });
    assert.equal(rows.length, 2, "Outremont survived an import that omitted it");
    assert.equal(rows.find((r) => r.boroughCode === "verdun")?.permitsIssued, 92);
    assert.equal(rows.find((r) => r.boroughCode === "outremont")?.permitsIssued, 40);
  });

  it("reports the latest period and reporting boroughs", async (t) => {
    if (skip) return t.skip(reason);
    await repo().upsertPermitStats([
      permitStat("verdun", "2026-05"),
      permitStat("anjou", "2026-07"),
    ]);
    assert.equal(await repo().getLatestPeriod(), "2026-07");
    assert.deepEqual(await repo().getReportingBoroughs(), ["anjou", "verdun"]);
  });
});

/* ── Mortgage rates ───────────────────────────────────────────────────────── */

describe("PostgresMortgageRateRepository against real PostgreSQL", () => {
  const repo = () => new PostgresMortgageRateRepository(sql());

  it("reads the lenders seeded by migration 002", async (t) => {
    if (skip) return t.skip(reason);
    const lenders = await repo().listLenders();
    assert.equal(lenders.length, 7);
    assert.ok(lenders.some((l) => l.id === "rbc"));
  });

  it("filters rates by ENUM columns without a type error", async (t) => {
    if (skip) return t.skip(reason);
    // The bug this catches: comparing product_type (an enum) to a text
    // parameter raises "operator does not exist: mortgage_product_type = text".
    await sql()(
      `INSERT INTO mortgage_rates
         (lender_id, product_type, term_years, borrower_profile, rate, effective_date,
          data_source_id, data_quality)
       VALUES ('rbc','fixed',5,'insured',4.79,'2026-08-20','src-demo-mortgage-rates','live'),
              ('rbc','variable',5,'insured',5.45,'2026-08-20','src-demo-mortgage-rates','live')`,
    );

    const fixed = await repo().listRates({ productType: "fixed" });
    assert.equal(fixed.length, 1);
    assert.equal(fixed[0].rate, 4.79);

    const insured = await repo().listRates({ borrowerProfile: "insured", termYears: 5 });
    assert.equal(insured.length, 2);
  });

  it("returns only the latest rate per lender/product/term/profile", async (t) => {
    if (skip) return t.skip(reason);
    await sql()(
      `INSERT INTO mortgage_rates
         (lender_id, product_type, term_years, borrower_profile, rate, effective_date,
          data_source_id, data_quality)
       VALUES ('rbc','fixed',5,'insured',4.99,'2026-07-01','src-demo-mortgage-rates','live'),
              ('rbc','fixed',5,'insured',4.79,'2026-08-20','src-demo-mortgage-rates','live')`,
    );
    const rates = await repo().listRates({ lenderId: "rbc" });
    assert.equal(rates.length, 1, "history is kept, but only the current rate is served");
    assert.equal(rates[0].rate, 4.79);
  });
});

/* ── Alert incidents ──────────────────────────────────────────────────────── */

describe("PostgresAlertIncidentStore against real PostgreSQL", () => {
  const store = () => new PostgresAlertIncidentStore(sql());

  const incident = (key: string, overrides = {}) => ({
    incidentKey: key,
    pipelineId: "src-boc-valet:5y-canada-bond",
    dataSourceId: "src-boc-valet",
    signalCode: "consecutive-failures" as const,
    severity: "critical" as const,
    openedAt: "2026-08-26T10:00:00.000Z",
    lastSeenAt: "2026-08-26T10:00:00.000Z",
    lastNotifiedAt: "2026-08-26T10:00:00.000Z",
    occurrences: 1,
    lastMessage: "2 consecutive import failures.",
    ...overrides,
  });

  it("declares itself durable", async (t) => {
    if (skip) return t.skip(reason);
    assert.equal(store().durable, true);
  });

  it("stores and reads back an incident with ISO timestamps", async (t) => {
    if (skip) return t.skip(reason);
    await store().put(incident("a:consecutive-failures"));
    const read = await store().get("a:consecutive-failures");

    assert.equal(read?.occurrences, 1);
    assert.equal(
      read?.openedAt,
      "2026-08-26T10:00:00.000Z",
      "timestamptz is converted back to an ISO string, matching the in-memory store",
    );
  });

  it("upserts, preserving openedAt through an escalation", async (t) => {
    if (skip) return t.skip(reason);
    await store().put(incident("b:consecutive-failures", { severity: "warning" }));
    await store().put(
      incident("b:consecutive-failures", {
        severity: "critical",
        lastSeenAt: "2026-08-26T16:00:00.000Z",
        lastNotifiedAt: "2026-08-26T16:00:00.000Z",
        occurrences: 2,
      }),
    );

    const read = await store().get("b:consecutive-failures");
    assert.equal(read?.severity, "critical");
    assert.equal(read?.occurrences, 2);
    assert.equal(
      read?.openedAt,
      "2026-08-26T10:00:00.000Z",
      "the incident is the same one — a recovery must report the true duration",
    );
    assert.equal((await store().list()).length, 1, "escalation did not create a second row");
  });

  it("deletes on recovery", async (t) => {
    if (skip) return t.skip(reason);
    await store().put(incident("c:consecutive-failures"));
    await store().delete("c:consecutive-failures");
    assert.equal(await store().get("c:consecutive-failures"), null);
  });

  /**
   * §7, the sequence this whole table exists to prevent:
   *
   *   fail → alert → restart → incident forgotten → same alert again
   */
  it("does NOT re-alert a known incident after a restart", async (t) => {
    if (skip) return t.skip(reason);
    const report = assessPipelineHealth({
      pipelineId: "src-boc-valet:5y-canada-bond",
      dataSourceId: "src-boc-valet",
      label: "5Y GoC bond yield",
      dataQuality: "live",
      freshness: "live",
      lag: 1,
      maxLag: 2,
      lagUnit: "business-day",
      latestObservationDate: "2026-08-25",
      importHealth: {
        dataSourceId: "src-boc-valet",
        lastSuccessAt: "2026-08-20T21:00:00.000Z",
        lastFailureAt: "2026-08-26T09:00:00.000Z",
        lastFailureMessage: "HTTP 503",
        lastFailureKind: "http",
        lastSuccessRecordsWritten: 10,
        consecutiveFailures: 2,
        totalRuns: 12,
      },
      lastRun: null,
    });

    // First evaluation, in "process A".
    const first = await evaluatePipelineAlerts([report], {
      store: store(),
      now: () => new Date("2026-08-26T10:00:00Z"),
    });
    assert.equal(first.alerts.length, 1, "the incident is raised once");

    // Restart: a brand-new store object over a brand-new connection, holding no
    // memory of the first evaluation.
    const afterRestart = await withFreshConnection((query) =>
      evaluatePipelineAlerts([report], {
        store: new PostgresAlertIncidentStore(query),
        now: () => new Date("2026-08-26T10:15:00Z"),
      }),
    );

    assert.deepEqual(afterRestart.alerts, [], "the restart did not re-alert");
    assert.equal(afterRestart.suppressed.length, 1, "it was suppressed, not lost");
    assert.equal(afterRestart.open.length, 1, "the incident is still open");
  });

  it("sends a recovery after a restart, with the true duration", async (t) => {
    if (skip) return t.skip(reason);
    await store().put(incident("src-boc-valet:5y-canada-bond:consecutive-failures"));

    const healthy = assessPipelineHealth({
      pipelineId: "src-boc-valet:5y-canada-bond",
      dataSourceId: "src-boc-valet",
      label: "5Y GoC bond yield",
      dataQuality: "live",
      freshness: "live",
      lag: 1,
      maxLag: 2,
      lagUnit: "business-day",
      latestObservationDate: "2026-08-26",
      importHealth: {
        dataSourceId: "src-boc-valet",
        lastSuccessAt: "2026-08-26T21:00:00.000Z",
        lastFailureAt: "2026-08-26T09:00:00.000Z",
        lastFailureMessage: null,
        lastFailureKind: null,
        lastSuccessRecordsWritten: 10,
        consecutiveFailures: 0,
        totalRuns: 13,
      },
      lastRun: null,
    });

    const recovered = await withFreshConnection((query) =>
      evaluatePipelineAlerts([healthy], {
        store: new PostgresAlertIncidentStore(query),
        now: () => new Date("2026-08-26T13:00:00Z"),
      }),
    );

    assert.equal(recovered.alerts.length, 1);
    assert.equal(recovered.alerts[0].kind, "recovered");
    assert.equal(
      recovered.alerts[0].detail.resolvedAfterSeconds,
      10_800,
      "three hours — openedAt survived the restart",
    );
    assert.deepEqual(recovered.open, [], "the incident closed");
  });
});

/* ── Market data ──────────────────────────────────────────────────────────── */

describe("PostgresMarketDataRepository against real PostgreSQL", () => {
  const repo = () => new PostgresMarketDataRepository(sql());

  it("reads the seeded data-source registry", async (t) => {
    if (skip) return t.skip(reason);
    const sources = await repo().listDataSources();
    assert.equal(sources.length, 15, "migration 006 seeded the registry");
    assert.ok(sources.some((s) => s.id === "src-boc-valet"));
  });

  it("reports no source as recently updated before any import has run", async (t) => {
    if (skip) return t.skip(reason);
    // A migration has not imported anything, so `last_updated` must be null.
    // Setting it in the seed would make every source claim to be current on the
    // day the schema was created.
    const sources = await repo().listDataSources();
    assert.equal(sources.every((s) => s.lastUpdated === null), true);
  });

  it("returns an empty list rather than throwing when no statistics exist", async (t) => {
    if (skip) return t.skip(reason);
    assert.deepEqual(await repo().listNeighbourhoods(), []);
  });

  it("reads import runs written by the pipeline's own store", async (t) => {
    if (skip) return t.skip(reason);
    const runs = new PostgresImportRunStore(sql());
    const id = await runs.startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
    await runs.completeRun(id, {
      status: "success", recordsReceived: 3, recordsWritten: 3, recordsRejected: 0,
    });

    // Two classes, one table: the dashboard reads what the pipeline wrote.
    const seen = await repo().listImportRuns();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].recordsImported, 3);
  });
});

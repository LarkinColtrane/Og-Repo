import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FAILURE_ALERT_THRESHOLD,
  assessPipelineHealth,
  derivePipelineState,
  overallPipelineState,
  toRunSummary,
  worstSeverity,
  type PipelineHealthInput,
  type PipelineRunSummary,
} from "@/lib/pipeline/health";
import type { ImportHealth } from "@/lib/data/import-run-store";

/**
 * The health engine is pure, so every state is reachable from a literal — no
 * clock to mock, no database, no browser. That is the reason it does not live
 * inside a React component.
 */

const health = (overrides: Partial<ImportHealth> = {}): ImportHealth => ({
  dataSourceId: "src-boc-valet",
  lastSuccessAt: "2026-08-25T21:00:00.000Z",
  lastFailureAt: null,
  lastFailureMessage: null,
  lastFailureKind: null,
  lastSuccessRecordsWritten: 10,
  consecutiveFailures: 0,
  totalRuns: 12,
  ...overrides,
});

const run = (overrides: Partial<PipelineRunSummary> = {}): PipelineRunSummary => ({
  id: "run-1",
  status: "success",
  startedAt: "2026-08-25T21:00:00.000Z",
  completedAt: "2026-08-25T21:00:04.000Z",
  recordsWritten: 10,
  recordsRejected: 0,
  errorKind: null,
  errorMessage: null,
  ...overrides,
});

const input = (overrides: Partial<PipelineHealthInput> = {}): PipelineHealthInput => ({
  pipelineId: "src-boc-valet:5y-canada-bond",
  dataSourceId: "src-boc-valet",
  label: "5Y GoC bond yield",
  dataQuality: "live",
  freshness: "live",
  lag: 1,
  maxLag: 2,
  lagUnit: "business-day",
  latestObservationDate: "2026-08-25",
  importHealth: health(),
  lastRun: run(),
  ...overrides,
});

const assess = (overrides: Partial<PipelineHealthInput> = {}) =>
  assessPipelineHealth(input(overrides), { now: () => new Date("2026-08-26T12:00:00Z") });

describe("pipeline states", () => {
  it("healthy: recent success, fresh data, no failures", () => {
    const report = assess();
    assert.equal(report.state, "healthy");
    assert.deepEqual(report.signals, []);
    assert.equal(report.severity, null);
  });

  it("degraded: a single failure since the last success", () => {
    const report = assess({
      importHealth: health({
        consecutiveFailures: 1,
        lastFailureAt: "2026-08-26T09:00:00.000Z",
        lastFailureMessage: "Request timed out after 10000ms.",
        lastFailureKind: "timeout",
      }),
    });
    assert.equal(report.state, "degraded");
    assert.equal(report.severity, "warning");

    // One code for import failure at both severities. Two codes would make the
    // second failure close the first incident — a "Recovered" notification sent
    // at the very moment the pipeline got worse.
    const signal = report.signals.find((s) => s.code === "consecutive-failures");
    assert.ok(signal);
    assert.equal(signal.severity, "warning");
    assert.match(signal.message, /The last import failed/);
  });

  it("escalates the same signal code from warning to critical at the threshold", () => {
    const failure = (count: number) =>
      assess({
        importHealth: health({
          consecutiveFailures: count,
          lastFailureMessage: "HTTP 503",
          lastFailureKind: "http",
        }),
      }).signals.find((s) => s.code === "consecutive-failures");

    assert.equal(failure(1)?.severity, "warning");
    assert.equal(failure(FAILURE_ALERT_THRESHOLD)?.severity, "critical");
  });

  it("degraded: the last run wrote some rows and rejected others", () => {
    const report = assess({
      lastRun: run({ status: "partial", recordsWritten: 8, recordsRejected: 2 }),
    });
    assert.equal(report.state, "degraded");
    const signal = report.signals.find((s) => s.code === "validation-rejections");
    assert.ok(signal);
    assert.match(signal.message, /rejected 2/);
  });

  it("degraded: an empty response from upstream", () => {
    const report = assess({
      lastRun: run({ status: "partial", errorKind: "empty-range", recordsWritten: 0 }),
    });
    assert.equal(report.state, "degraded");
    assert.ok(report.signals.some((s) => s.code === "empty-range"));
  });

  it(`failing: ${FAILURE_ALERT_THRESHOLD} consecutive failures`, () => {
    const report = assess({
      importHealth: health({
        consecutiveFailures: FAILURE_ALERT_THRESHOLD,
        lastFailureAt: "2026-08-26T09:00:00.000Z",
        lastFailureMessage: "The Bank of Canada returned HTTP 503.",
        lastFailureKind: "http",
      }),
    });
    assert.equal(report.state, "failing");
    assert.equal(report.severity, "critical");
    assert.match(report.headline, /consecutive import failures/);
  });

  it("one failure short of the threshold is degraded, not failing", () => {
    const report = assess({
      importHealth: health({
        consecutiveFailures: FAILURE_ALERT_THRESHOLD - 1,
        lastFailureMessage: "blip",
        lastFailureKind: "network",
      }),
    });
    assert.equal(report.state, "degraded");
  });

  it("failing: a suspected upstream unit change, even on the first failure", () => {
    const report = assess({
      importHealth: health({
        consecutiveFailures: 1,
        lastFailureKind: "unit-anomaly",
        lastFailureMessage: "Median value 0.032 is far outside the plausible band.",
      }),
    });
    assert.equal(report.state, "failing");
    assert.ok(report.signals.some((s) => s.code === "unit-anomaly"));
  });

  it("failing: the store refused a write, even on the first failure", () => {
    const report = assess({
      importHealth: health({
        consecutiveFailures: 1,
        lastFailureKind: "persistence",
        lastFailureMessage: "This repository is read-only.",
      }),
    });
    assert.equal(report.state, "failing");
    assert.ok(report.signals.some((s) => s.code === "persistence-failure"));
  });

  it("stale: imports succeeding but the data has stopped moving", () => {
    const report = assess({
      freshness: "stale",
      lag: 9,
      latestObservationDate: "2026-08-13",
    });
    assert.equal(report.state, "stale");
    const signal = report.signals.find((s) => s.code === "stale-data");
    assert.ok(signal);
    assert.match(signal.message, /9 business days/);
  });

  it("failing outranks stale, because the broken import is the thing to fix", () => {
    const report = assess({
      freshness: "stale",
      lag: 9,
      importHealth: health({ consecutiveFailures: 4, lastFailureMessage: "HTTP 500" }),
    });
    assert.equal(report.state, "failing");
    assert.ok(
      report.signals.some((s) => s.code === "stale-data"),
      "the staleness is still reported, just not as the headline",
    );
  });

  it("demo: a generated series is never healthy, stale or failing", () => {
    const report = assess({ dataQuality: "demo", freshness: "demo", lag: null });
    assert.equal(report.state, "demo");
    assert.equal(report.severity, "info", "demo data does not alert");
  });

  it("demo outranks a failed import against the read-only demo store", () => {
    const report = assess({
      dataQuality: "demo",
      freshness: "demo",
      importHealth: health({ consecutiveFailures: 3, lastFailureKind: "persistence" }),
    });
    assert.equal(report.state, "demo");
  });

  it("unavailable: no observations and no successful import, ever", () => {
    const report = assess({
      freshness: "unavailable",
      lag: null,
      latestObservationDate: null,
      importHealth: health({ lastSuccessAt: null, totalRuns: 0, lastSuccessRecordsWritten: null }),
      lastRun: null,
    });
    assert.equal(report.state, "unavailable");
    assert.ok(report.signals.some((s) => s.code === "never-imported"));
  });
});

describe("report contents", () => {
  it("carries both freshness and run history, because they fail independently", () => {
    const report = assess({
      freshness: "live",
      importHealth: health({
        consecutiveFailures: 3,
        lastSuccessAt: "2026-08-20T21:00:00.000Z",
        lastFailureAt: "2026-08-26T09:00:00.000Z",
        lastFailureMessage: "HTTP 503",
      }),
    });
    assert.equal(report.freshness, "live", "the data still looks recent");
    assert.equal(report.state, "failing", "but nothing is arriving");
    assert.equal(report.lastSuccessAt, "2026-08-20T21:00:00.000Z");
    assert.equal(report.lastFailureAt, "2026-08-26T09:00:00.000Z");
  });

  it("stamps the assessment time from the injected clock", () => {
    assert.equal(assess().assessedAt, "2026-08-26T12:00:00.000Z");
  });

  it("keeps the registry source id alongside the pipeline id", () => {
    const report = assess();
    assert.equal(report.dataSourceId, "src-boc-valet");
    assert.equal(report.pipelineId, "src-boc-valet:5y-canada-bond");
  });
});

describe("helpers", () => {
  it("worstSeverity picks critical over warning over info", () => {
    assert.equal(
      worstSeverity([
        { code: "empty-range", severity: "warning", message: "" },
        { code: "stale-data", severity: "critical", message: "" },
        { code: "demo-fallback", severity: "info", message: "" },
      ]),
      "critical",
    );
    assert.equal(worstSeverity([]), null);
  });

  it("derivePipelineState is healthy with no signals", () => {
    assert.equal(derivePipelineState([]), "healthy");
  });

  it("overallPipelineState reports the worst of several pipelines", () => {
    const healthy = assess();
    const broken = assess({
      pipelineId: "src-boc-valet:boc-policy-rate",
      importHealth: health({ consecutiveFailures: 3, lastFailureMessage: "x" }),
    });
    assert.equal(overallPipelineState([healthy, broken]), "failing");
    assert.equal(overallPipelineState([healthy]), "healthy");
    assert.equal(overallPipelineState([]), "unavailable");
  });

  it("toRunSummary maps a stored run and defaults its optional fields", () => {
    const summary = toRunSummary({
      id: "run-mem-3",
      dataSourceId: "src-boc-valet",
      startedAt: "2026-08-26T09:00:00.000Z",
      completedAt: "2026-08-26T09:00:02.000Z",
      status: "partial",
      recordsImported: 7,
      errorMessage: "3 rejected",
      triggeredBy: "schedule",
    });
    assert.equal(summary?.recordsWritten, 7);
    assert.equal(summary?.recordsRejected, 0);
    assert.equal(summary?.errorKind, null);
    assert.equal(toRunSummary(undefined), null);
  });
});

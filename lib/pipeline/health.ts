import type { BenchmarkFreshness } from "@/types/benchmark";
import type { ImportHealth } from "@/lib/data/import-run-store";
import type { ImportRun, ImportRunStatus } from "@/types";

/**
 * The pipeline health engine.
 *
 * ## Why this is not in a component
 *
 * "Is the pipeline working?" is answered in three places: the operations
 * dashboard, the alerting job, and the diagnostics endpoint. If the rule lived
 * in a React component, the other two would each grow their own copy, and the
 * three would drift — which is how a dashboard ends up showing green while an
 * alert fires. So the rule lives here, in a pure function over plain data, and
 * the component renders what it returns.
 *
 * Pure also means testable: every state below is reachable from a literal object
 * in a test file, with no clock to mock, no database to stand up and no browser.
 *
 * ## The two questions, kept separate
 *
 * A pipeline has two independent failure modes and conflating them hides half
 * of them:
 *
 *  - **Is the data current?** — freshness of the newest observation.
 *  - **Is anything still trying?** — outcome of the recent import runs.
 *
 * A publisher can pause while every run succeeds (fresh pipeline, stale data).
 * Every run since Tuesday can have failed while the data still looks recent
 * (broken pipeline, data not yet old enough to notice). Both are reported.
 */

/** The six states an operator needs to tell apart. */
export type PipelineState =
  /** Recent successful import, data within its publication lag. */
  | "healthy"
  /** Working, but something is off: one failure, or rows being rejected. */
  | "degraded"
  /** Repeated failures. Nothing new is arriving. */
  | "failing"
  /** Imports may be fine, but the newest observation is older than expected. */
  | "stale"
  /** Serving the generated fallback. Not a measurement, so not "healthy". */
  | "demo"
  /** Nothing on record at all, and no successful import to explain it. */
  | "unavailable";

/** Ranked worst-first, for sorting a dashboard so problems surface at the top. */
export const PIPELINE_STATE_RANK: Record<PipelineState, number> = {
  failing: 0,
  stale: 1,
  degraded: 2,
  unavailable: 3,
  demo: 4,
  healthy: 5,
};

/**
 * One observed fact about the pipeline.
 *
 * Signals are the unit of both display and alerting. Deriving alerts from the
 * same signals the dashboard renders is what guarantees the page and the
 * notification can never disagree about what is wrong.
 */
export interface PipelineSignal {
  code: PipelineSignalCode;
  severity: SignalSeverity;
  /** One sentence, written for a human reading an alert at 2am. */
  message: string;
  /** Structured context. Never contains secrets or raw upstream payloads. */
  detail?: Record<string, unknown>;
}

export type SignalSeverity = "info" | "warning" | "critical";

export type PipelineSignalCode =
  /**
   * Imports are failing. One code, not two, deliberately: a single failure and a
   * run of them are the same condition at two severities, and splitting them
   * into separate codes made escalation look like a recovery — the second
   * failure would close the "one failure" incident (sending "Recovered") while
   * opening a "repeated failures" one in the same breath. As one incident, the
   * second failure escalates it and the channel reads correctly.
   */
  | "consecutive-failures"
  /** Newest observation older than the series' business-day allowance. */
  | "stale-data"
  /** The last run wrote rows but refused others. */
  | "validation-rejections"
  /** A batch was refused wholesale because the values looked mis-scaled. */
  | "unit-anomaly"
  /** The store rejected a write. */
  | "persistence-failure"
  /** Upstream returned an empty range where one was expected. */
  | "empty-range"
  /** No observations and no successful import, ever. */
  | "never-imported"
  /** Serving generated data because no real store is connected. */
  | "demo-fallback";

/**
 * Consecutive failures at which a pipeline is considered *failing* rather than
 * merely degraded.
 *
 * Two, not one. A single failed run is routinely a transient upstream blip, and
 * treating it as an outage trains people to ignore the channel. Two in a row is
 * a pattern. The first failure is still reported — as a warning — so nothing is
 * hidden; what changes at the threshold is the severity and the state.
 */
export const FAILURE_ALERT_THRESHOLD = 2;

/** What the engine needs to judge one pipeline. All plain data. */
export interface PipelineHealthInput {
  /**
   * Identity of the monitored pipeline, unique across everything monitored.
   *
   * Distinct from `dataSourceId` because one registered source can feed several
   * pipelines — all three Bank of Canada series come from `src-boc-valet`, and a
   * stalled 5-year import must not be able to close an open incident on the
   * policy rate. Incident keys are built from this.
   */
  pipelineId: string;
  /** Id in the data-source registry, for provenance and dashboard grouping. */
  dataSourceId: string;
  /** Human label for the dashboard and alert subject line. */
  label: string;
  /** Quality of the store currently backing this data. */
  dataQuality: "demo" | "live";
  /** Freshness of the newest observation, or null when there is nothing to judge. */
  freshness: BenchmarkFreshness | null;
  businessDayLag: number | null;
  maxBusinessDayLag: number | null;
  latestObservationDate: string | null;
  /** Summary of the run history, from the import-run store. */
  importHealth: ImportHealth;
  /** The most recent completed run, when there is one. */
  lastRun: PipelineRunSummary | null;
}

export interface PipelineRunSummary {
  id: string;
  status: ImportRunStatus;
  startedAt: string;
  completedAt: string | null;
  recordsWritten: number;
  recordsRejected: number;
  errorKind: string | null;
  errorMessage: string | null;
}

export interface PipelineHealthReport {
  pipelineId: string;
  dataSourceId: string;
  label: string;
  state: PipelineState;
  /** One line summarising the state, safe to show on a card. */
  headline: string;
  signals: PipelineSignal[];
  /** Worst severity across the signals, or null when there are none. */
  severity: SignalSeverity | null;
  dataQuality: "demo" | "live";
  freshness: BenchmarkFreshness | null;
  businessDayLag: number | null;
  latestObservationDate: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  totalRuns: number;
  /** ISO timestamp of when this assessment was made. */
  assessedAt: string;
}

const SEVERITY_RANK: Record<SignalSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Assess one pipeline.
 *
 * Signals are collected first, then the state is derived from them. Doing it in
 * that order — rather than a nest of conditionals returning a state directly —
 * is what lets the dashboard explain *why* a pipeline is amber instead of just
 * colouring it.
 */
export function assessPipelineHealth(
  input: PipelineHealthInput,
  options: { now?: () => Date } = {},
): PipelineHealthReport {
  const now = options.now ?? (() => new Date());
  const signals = collectSignals(input);
  const state = derivePipelineState(signals);

  return {
    pipelineId: input.pipelineId,
    dataSourceId: input.dataSourceId,
    label: input.label,
    state,
    headline: describeState(state, input, signals),
    signals,
    severity: worstSeverity(signals),
    dataQuality: input.dataQuality,
    freshness: input.freshness,
    businessDayLag: input.businessDayLag,
    latestObservationDate: input.latestObservationDate,
    consecutiveFailures: input.importHealth.consecutiveFailures,
    lastSuccessAt: input.importHealth.lastSuccessAt,
    lastFailureAt: input.importHealth.lastFailureAt,
    lastFailureMessage: input.importHealth.lastFailureMessage,
    totalRuns: input.importHealth.totalRuns,
    assessedAt: now().toISOString(),
  };
}

function collectSignals(input: PipelineHealthInput): PipelineSignal[] {
  const signals: PipelineSignal[] = [];
  const { importHealth: health, lastRun } = input;

  // ── Nothing real behind this at all ──────────────────────────────────────
  if (input.dataQuality === "demo") {
    signals.push({
      code: "demo-fallback",
      severity: "info",
      message:
        "Serving generated demo data. No real store is connected, so freshness does not apply.",
      detail: { dataSourceId: input.dataSourceId, pipelineId: input.pipelineId },
    });
  } else if (input.latestObservationDate === null && health.lastSuccessAt === null) {
    signals.push({
      code: "never-imported",
      severity: "warning",
      message: "No observations on record and no import has ever succeeded.",
      detail: { totalRuns: health.totalRuns },
    });
  }

  // ── Run outcomes ─────────────────────────────────────────────────────────
  if (health.consecutiveFailures > 0) {
    const repeated = health.consecutiveFailures >= FAILURE_ALERT_THRESHOLD;
    signals.push({
      code: "consecutive-failures",
      severity: repeated ? "critical" : "warning",
      message: repeated
        ? `${health.consecutiveFailures} consecutive import failures since the last success. Latest: ${health.lastFailureMessage ?? "no message recorded"}`
        : `The last import failed: ${health.lastFailureMessage ?? "no message recorded"}`,
      detail: {
        consecutiveFailures: health.consecutiveFailures,
        errorKind: health.lastFailureKind,
        lastSuccessAt: health.lastSuccessAt,
      },
    });
  }

  // A failure kind worth naming on its own, because the fix differs from a
  // network blip: a unit anomaly means the feed changed shape, and a
  // persistence failure means our own store refused the write.
  if (health.consecutiveFailures > 0 && health.lastFailureKind === "unit-anomaly") {
    signals.push({
      code: "unit-anomaly",
      severity: "critical",
      message:
        "A batch was refused because the values looked mis-scaled — the upstream units may have changed. Nothing was written.",
      detail: { errorKind: health.lastFailureKind },
    });
  }

  if (health.consecutiveFailures > 0 && health.lastFailureKind === "persistence") {
    signals.push({
      code: "persistence-failure",
      severity: "critical",
      message: `Validated rows could not be written to the store: ${health.lastFailureMessage ?? "no message recorded"}`,
      detail: { errorKind: health.lastFailureKind },
    });
  }

  if (lastRun && lastRun.status === "partial" && lastRun.recordsRejected > 0) {
    signals.push({
      code: "validation-rejections",
      severity: "warning",
      message: `The last import wrote ${lastRun.recordsWritten} row(s) but rejected ${lastRun.recordsRejected}. Something upstream is producing values this pipeline will not accept.`,
      detail: {
        runId: lastRun.id,
        recordsWritten: lastRun.recordsWritten,
        recordsRejected: lastRun.recordsRejected,
        errorMessage: lastRun.errorMessage,
      },
    });
  }

  if (lastRun && lastRun.status === "partial" && lastRun.errorKind === "empty-range") {
    signals.push({
      code: "empty-range",
      severity: "warning",
      message:
        "The last import returned no observations. One empty range is normal around a holiday; a run of them is not.",
      detail: { runId: lastRun.id },
    });
  }

  // ── Data freshness ───────────────────────────────────────────────────────
  if (input.freshness === "stale") {
    signals.push({
      code: "stale-data",
      severity: "critical",
      message: `The newest observation is ${input.latestObservationDate ?? "unknown"}, ${input.businessDayLag ?? "?"} business days old — beyond the ${input.maxBusinessDayLag ?? "?"} allowed for this series.`,
      detail: {
        latestObservationDate: input.latestObservationDate,
        businessDayLag: input.businessDayLag,
        maxBusinessDayLag: input.maxBusinessDayLag,
      },
    });
  }

  return signals;
}

/**
 * Collapse signals into one state.
 *
 * Order matters and is deliberate. `demo` outranks everything because a
 * generated series has no freshness to be wrong about — calling it "failing"
 * would be describing a pipeline that was never running. `failing` outranks
 * `stale` because when imports are broken, staleness is the symptom and the
 * broken import is the thing to go and fix.
 */
export function derivePipelineState(signals: PipelineSignal[]): PipelineState {
  const has = (code: PipelineSignalCode) => signals.some((s) => s.code === code);

  const hasCritical = (code: PipelineSignalCode) =>
    signals.some((s) => s.code === code && s.severity === "critical");

  if (has("demo-fallback")) return "demo";
  if (has("never-imported")) return "unavailable";
  // `consecutive-failures` is only critical past the threshold; below it the
  // pipeline is degraded, not failing.
  if (
    hasCritical("consecutive-failures") ||
    has("unit-anomaly") ||
    has("persistence-failure")
  ) {
    return "failing";
  }
  if (has("stale-data")) return "stale";
  if (signals.some((s) => s.severity === "warning")) return "degraded";
  return "healthy";
}

export function worstSeverity(signals: PipelineSignal[]): SignalSeverity | null {
  if (signals.length === 0) return null;
  return signals.reduce<SignalSeverity>(
    (worst, signal) =>
      SEVERITY_RANK[signal.severity] < SEVERITY_RANK[worst] ? signal.severity : worst,
    "info",
  );
}

function describeState(
  state: PipelineState,
  input: PipelineHealthInput,
  signals: PipelineSignal[],
): string {
  switch (state) {
    case "healthy":
      return input.latestObservationDate
        ? `Up to date. Newest observation ${input.latestObservationDate}.`
        : "Up to date.";
    case "degraded":
      return signals.find((s) => s.severity === "warning")?.message ?? "Working, with warnings.";
    case "failing":
      return (
        signals.find((s) => s.severity === "critical")?.message ??
        "Imports are failing repeatedly."
      );
    case "stale":
      return `Imports are running but the data has stopped moving: newest observation ${input.latestObservationDate ?? "unknown"}.`;
    case "demo":
      return "Demo data. Not a market measurement.";
    case "unavailable":
      return "No data on record for this source yet.";
  }
}

/** Narrow a stored run to the summary the engine needs. */
export function toRunSummary(
  run: (ImportRun & { errorKind?: string | null; recordsRejected?: number }) | undefined,
): PipelineRunSummary | null {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    recordsWritten: run.recordsImported,
    recordsRejected: run.recordsRejected ?? 0,
    errorKind: run.errorKind ?? null,
    errorMessage: run.errorMessage,
  };
}

/** Worst state across several pipelines — the one a dashboard header shows. */
export function overallPipelineState(reports: PipelineHealthReport[]): PipelineState {
  if (reports.length === 0) return "unavailable";
  return reports.reduce<PipelineState>(
    (worst, report) =>
      PIPELINE_STATE_RANK[report.state] < PIPELINE_STATE_RANK[worst] ? report.state : worst,
    "healthy",
  );
}

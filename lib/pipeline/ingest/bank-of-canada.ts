import type { BenchmarkSeriesCode } from "@/types/benchmark";
import type { ImportRunStatus } from "@/types";
import {
  BankOfCanadaConnector,
  BankOfCanadaError,
} from "@/lib/pipeline/connectors/bank-of-canada/client";
import { getBenchmarkSeries } from "@/lib/pipeline/connectors/bank-of-canada/series";
import { normalizeBankOfCanadaSeries } from "@/lib/pipeline/transforms/bank-of-canada";
import {
  detectUnitAnomaly,
  validateBenchmarkObservations,
  type ValidationIssue,
} from "@/lib/pipeline/validate";
import type { MarketBenchmarkRepository } from "@/lib/data/benchmark-repository";
import type { ImportRunStore } from "@/lib/data/import-run-store";

/**
 * The ingest service: fetch → normalize → validate → persist → record.
 *
 * Deliberately a plain function taking its dependencies as arguments rather than
 * anything route-shaped. The same call serves the internal endpoint, a future
 * scheduler and the tests, and none of them needs an HTTP server to exist.
 *
 * The contract that matters: **an import run is always recorded**, success or
 * failure. Every exit path from this function goes through `completeRun`, which
 * is what makes "the pipeline has not succeeded since March" a question the
 * diagnostics endpoint can answer rather than a thing somebody notices when the
 * chart looks wrong.
 */

export interface IngestOptions {
  seriesCode: BenchmarkSeriesCode;
  /** Inclusive `YYYY-MM-DD`. Omit with `endDate` to fetch the whole series. */
  startDate?: string;
  endDate?: string;
  /** Alternative to a range: the N most recent observations. */
  recent?: number;
  triggeredBy?: "schedule" | "manual" | "webhook";
  signal?: AbortSignal;
}

export interface IngestDependencies {
  connector: BankOfCanadaConnector;
  repository: MarketBenchmarkRepository;
  importRuns: ImportRunStore;
  /** Injected so tests get deterministic timestamps. */
  now?: () => Date;
}

export interface IngestResult {
  status: ImportRunStatus;
  runId: string;
  seriesCode: BenchmarkSeriesCode;
  /** Rows the publisher returned. */
  recordsReceived: number;
  /** Rows that passed validation and were written. */
  recordsWritten: number;
  /** Rows refused by validation. */
  recordsRejected: number;
  /**
   * Rows the publisher returned with no value — holidays and non-publication
   * days. Expected, and counted separately from rejections so a normal import
   * does not look partially broken.
   */
  recordsSkipped: number;
  rejections: ValidationIssue[];
  firstObservationDate: string | null;
  lastObservationDate: string | null;
  errorMessage: string | null;
  errorKind: string | null;
  requestUrl: string;
  durationMs: number;
}

/** Raised when the pipeline refuses a batch. Carries the run for reporting. */
export class IngestFailedError extends Error {
  constructor(
    message: string,
    readonly result: IngestResult,
  ) {
    super(message);
    this.name = "IngestFailedError";
  }
}

export async function ingestBankOfCanadaSeries(
  options: IngestOptions,
  dependencies: IngestDependencies,
): Promise<IngestResult> {
  const { connector, repository, importRuns } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const series = getBenchmarkSeries(options.seriesCode);
  const startedAt = now().getTime();

  const request = {
    upstreamCode: series.upstreamCode,
    startDate: options.startDate,
    endDate: options.endDate,
    recent: options.recent,
    signal: options.signal,
  };
  const requestUrl = connector.buildUrl(request);

  const runId = await importRuns.startRun({
    dataSourceId: series.sourceId,
    triggeredBy: options.triggeredBy ?? "manual",
    metadata: {
      seriesCode: series.code,
      upstreamCode: series.upstreamCode,
      requestUrl,
      startDate: options.startDate ?? null,
      endDate: options.endDate ?? null,
      recent: options.recent ?? null,
    },
  });

  const base = {
    runId,
    seriesCode: series.code,
    recordsReceived: 0,
    recordsWritten: 0,
    recordsRejected: 0,
    recordsSkipped: 0,
    rejections: [] as ValidationIssue[],
    firstObservationDate: null as string | null,
    lastObservationDate: null as string | null,
    requestUrl,
  };

  const fail = async (
    message: string,
    errorKind: string,
    partial: Partial<IngestResult> = {},
  ): Promise<never> => {
    const result: IngestResult = {
      ...base,
      ...partial,
      status: "failed",
      errorMessage: message,
      errorKind,
      durationMs: now().getTime() - startedAt,
    };
    await importRuns.completeRun(runId, {
      status: "failed",
      recordsReceived: result.recordsReceived,
      recordsWritten: result.recordsWritten,
      recordsRejected: result.recordsRejected,
      errorMessage: message,
      errorKind,
      metadata: { durationMs: result.durationMs },
    });
    throw new IngestFailedError(message, result);
  };

  // ── 1. Fetch ────────────────────────────────────────────────────────────
  let response;
  try {
    response = await connector.fetchObservations(request);
  } catch (error) {
    const kind = error instanceof BankOfCanadaError ? error.kind : "unknown";
    return fail(
      error instanceof Error ? error.message : String(error),
      kind,
    );
  }

  // ── 2. Normalize ────────────────────────────────────────────────────────
  const retrievedAt = now().toISOString();
  const normalized = normalizeBankOfCanadaSeries(response, { series, retrievedAt });

  base.recordsReceived = normalized.received;
  base.recordsSkipped = normalized.skipped.length;

  if (normalized.received === 0) {
    // An empty range is not automatically wrong — asking for a single holiday
    // legitimately returns nothing — but it is worth recording as partial so a
    // scheduler that starts returning nothing every day becomes visible.
    const result: IngestResult = {
      ...base,
      status: "partial",
      errorMessage: "The Bank of Canada returned no observations for this range.",
      errorKind: "empty-range",
      durationMs: now().getTime() - startedAt,
    };
    await importRuns.completeRun(runId, {
      status: "partial",
      recordsReceived: 0,
      recordsWritten: 0,
      recordsRejected: 0,
      errorMessage: result.errorMessage,
      errorKind: "empty-range",
    });
    return result;
  }

  // ── 3. Validate ─────────────────────────────────────────────────────────
  const { valid, rejected } = validateBenchmarkObservations(normalized.observations);
  base.recordsRejected = rejected.length;
  base.rejections = rejected;

  // A batch that is entirely rejected means the feed changed shape, not that
  // one day was odd. Writing the survivors of that would be writing nothing.
  if (valid.length === 0) {
    return fail(
      `All ${normalized.observations.length} observations failed validation. First problem: ${rejected[0]?.message ?? "unknown"}`,
      "validation",
    );
  }

  const anomaly = detectUnitAnomaly(valid);
  if (anomaly) return fail(anomaly, "unit-anomaly");

  // ── 4. Persist ──────────────────────────────────────────────────────────
  let written: number;
  try {
    written = await repository.upsertObservations(valid);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : String(error),
      "persistence",
    );
  }

  // ── 5. Record ───────────────────────────────────────────────────────────
  // Rejected rows make the run partial, not successful. A run that says
  // "success" while having thrown away a tenth of the batch is how a slow feed
  // regression goes unnoticed for months.
  const status: ImportRunStatus = rejected.length > 0 ? "partial" : "success";

  const result: IngestResult = {
    ...base,
    status,
    recordsWritten: written,
    firstObservationDate: valid[0].observationDate,
    lastObservationDate: valid[valid.length - 1].observationDate,
    errorMessage:
      rejected.length > 0
        ? `${rejected.length} observation(s) failed validation and were not written. First: ${rejected[0].message}`
        : null,
    errorKind: rejected.length > 0 ? "partial-validation" : null,
    durationMs: now().getTime() - startedAt,
  };

  await importRuns.completeRun(runId, {
    status,
    recordsReceived: result.recordsReceived,
    recordsWritten: written,
    recordsRejected: rejected.length,
    errorMessage: result.errorMessage,
    errorKind: result.errorKind,
    metadata: {
      durationMs: result.durationMs,
      firstObservationDate: result.firstObservationDate,
      lastObservationDate: result.lastObservationDate,
      skipped: result.recordsSkipped,
    },
  });

  return result;
}

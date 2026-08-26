import type { ImportRunStatus, Period } from "@/types";
import {
  MontrealOpenDataConnector,
  MontrealOpenDataError,
} from "@/lib/pipeline/connectors/montreal-open-data/client";
import {
  describeSchemaMismatch,
  resolveFields,
  type DatasetDefinition,
} from "@/lib/pipeline/connectors/montreal-open-data/datasets";
import {
  normalizeMontrealPermits,
  type PermitRowRejection,
} from "@/lib/pipeline/transforms/montreal-permits";
import {
  detectPermitBatchAnomaly,
  validatePermitStats,
  type ValidationIssue,
} from "@/lib/pipeline/validate";
import type { CivicDataRepository } from "@/lib/data/civic-repository";
import type { ImportRunStore } from "@/lib/data/import-run-store";

/**
 * The civic ingest service: discover → fetch → resolve schema → normalize →
 * validate → persist → record.
 *
 * The same shape as `ingestBankOfCanadaSeries`, deliberately. A second pipeline
 * that invented its own structure would mean two things to learn, two places to
 * look when something breaks, and two implementations of "always record a run".
 * The differences are only where the sources genuinely differ:
 *
 *  - **A discovery step.** CKAN assigns resource ids; they cannot be
 *    hard-coded, so the resource is looked up from the dataset each run.
 *  - **A schema-resolution step.** Column names are a per-dataset fact, so the
 *    contract is matched against the response *before any row is read*.
 *
 * The contract that matters is unchanged: **an import run is always recorded**,
 * success or failure, on every exit path.
 */

export interface CivicIngestOptions {
  dataset: DatasetDefinition;
  /** Keep only periods at or after this bound. */
  from?: Period;
  /** Keep only periods at or before this bound. */
  to?: Period;
  /** Stop reading after this many source rows. Bounds an unattended run. */
  maxRecords?: number;
  triggeredBy?: "schedule" | "manual" | "webhook";
  signal?: AbortSignal;
}

export interface CivicIngestDependencies {
  connector: MontrealOpenDataConnector;
  repository: CivicDataRepository;
  importRuns: ImportRunStore;
  /** Injected so tests get deterministic timestamps. */
  now?: () => Date;
}

export interface CivicIngestResult {
  status: ImportRunStatus;
  runId: string;
  datasetCode: string;
  /** The CKAN resource actually read, once discovery has run. */
  resourceId: string | null;
  /** Source rows the publisher returned. */
  recordsReceived: number;
  /** Borough-month statistics written. */
  recordsWritten: number;
  /** Borough-month statistics refused by validation. */
  recordsRejected: number;
  /** Source rows refused before aggregation, with reasons. */
  rowsRejected: PermitRowRejection[];
  rejections: ValidationIssue[];
  /** Borough names the registry did not recognise. Actionable, so surfaced. */
  unknownBoroughs: string[];
  /** Optional contract fields the resource did not carry. */
  missingOptionalFields: string[];
  firstPeriod: Period | null;
  lastPeriod: Period | null;
  errorMessage: string | null;
  errorKind: string | null;
  requestUrl: string | null;
  durationMs: number;
}

/** Raised when the pipeline refuses a batch. Carries the run for reporting. */
export class CivicIngestFailedError extends Error {
  constructor(
    message: string,
    readonly result: CivicIngestResult,
  ) {
    super(message);
    this.name = "CivicIngestFailedError";
  }
}

export async function ingestMontrealPermits(
  options: CivicIngestOptions,
  dependencies: CivicIngestDependencies,
): Promise<CivicIngestResult> {
  const { connector, repository, importRuns } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const { dataset } = options;
  const startedAt = now().getTime();

  const runId = await importRuns.startRun({
    dataSourceId: dataset.sourceId,
    triggeredBy: options.triggeredBy ?? "manual",
    metadata: {
      datasetCode: dataset.code,
      packageSlug: dataset.packageSlug,
      from: options.from ?? null,
      to: options.to ?? null,
      maxRecords: options.maxRecords ?? null,
      fieldsVerified: dataset.fieldsVerified,
    },
  });

  const base = {
    runId,
    datasetCode: dataset.code,
    resourceId: dataset.resourceId,
    recordsReceived: 0,
    recordsWritten: 0,
    recordsRejected: 0,
    rowsRejected: [] as PermitRowRejection[],
    rejections: [] as ValidationIssue[],
    unknownBoroughs: [] as string[],
    missingOptionalFields: [] as string[],
    firstPeriod: null as Period | null,
    lastPeriod: null as Period | null,
    requestUrl: null as string | null,
  };

  const fail = async (
    message: string,
    errorKind: string,
    partial: Partial<CivicIngestResult> = {},
  ): Promise<never> => {
    const result: CivicIngestResult = {
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
      metadata: { durationMs: result.durationMs, resourceId: result.resourceId },
    });
    throw new CivicIngestFailedError(message, result);
  };

  // ── 1. Discover the resource ────────────────────────────────────────────
  // CKAN assigns resource ids, so they cannot be hard-coded: a re-upload by the
  // publisher would break a pinned UUID silently. Looking it up each run costs
  // one request and makes the pipeline survive that.
  let resourceId = dataset.resourceId;
  if (!resourceId) {
    try {
      const pkg = await connector.fetchPackage(dataset.packageSlug, options.signal);
      const queryable = (pkg.resources ?? []).filter((r) => r.datastore_active);
      const preferred =
        queryable.find(
          (r) =>
            (!dataset.resourceHint?.format ||
              r.format?.toUpperCase() === dataset.resourceHint.format.toUpperCase()) &&
            (!dataset.resourceHint?.nameContains ||
              (r.name ?? "").toLowerCase().includes(dataset.resourceHint.nameContains.toLowerCase())),
        ) ?? queryable[0];

      if (!preferred) {
        return fail(
          `Dataset "${dataset.packageSlug}" has no datastore-queryable resource. It publishes ${(pkg.resources ?? []).length} resource(s), none with datastore_active. A file-only dataset needs a CSV reader, not this connector.`,
          "no-queryable-resource",
        );
      }
      resourceId = preferred.id;
      base.resourceId = resourceId;
    } catch (error) {
      const kind = error instanceof MontrealOpenDataError ? error.kind : "unknown";
      return fail(error instanceof Error ? error.message : String(error), kind);
    }
  }

  // ── 2. Fetch ────────────────────────────────────────────────────────────
  let page;
  try {
    page = await connector.fetchRecords({
      resourceId,
      maxRecords: options.maxRecords,
      signal: options.signal,
    });
    base.requestUrl = page.requestUrl;
  } catch (error) {
    const kind = error instanceof MontrealOpenDataError ? error.kind : "unknown";
    return fail(error instanceof Error ? error.message : String(error), kind);
  }

  base.recordsReceived = page.records.length;

  if (page.records.length === 0) {
    // An empty extract is recorded as partial rather than failed: a filtered
    // query legitimately returns nothing. Recording it means a scheduler that
    // starts returning nothing every day becomes visible.
    const result: CivicIngestResult = {
      ...base,
      status: "partial",
      errorMessage: `The "${dataset.title}" resource returned no rows.`,
      errorKind: "empty-extract",
      durationMs: now().getTime() - startedAt,
    };
    await importRuns.completeRun(runId, {
      status: "partial",
      recordsReceived: 0,
      recordsWritten: 0,
      recordsRejected: 0,
      errorMessage: result.errorMessage,
      errorKind: "empty-extract",
    });
    return result;
  }

  // ── 3. Resolve the field contract ───────────────────────────────────────
  // Before a single row is read. Discovering on row 40,000 that a column was
  // missing is discovering it too late.
  const fields = resolveFields(dataset, page.fields, page.records[0]);
  base.missingOptionalFields = fields.missingOptional;

  if (fields.missingRequired.length > 0) {
    return fail(describeSchemaMismatch(dataset, fields), "schema-mismatch");
  }

  // ── 4. Normalize and aggregate ──────────────────────────────────────────
  const retrievedAt = now().toISOString();
  const normalized = normalizeMontrealPermits(page.records, {
    dataset,
    fields,
    retrievedAt,
    from: options.from,
    to: options.to,
  });

  base.rowsRejected = normalized.rejected;
  base.unknownBoroughs = normalized.unknownBoroughs;

  if (normalized.stats.length === 0) {
    return fail(
      `All ${normalized.received} source rows were unusable — none produced a borough-month statistic. First problem: ${normalized.rejected[0]?.message ?? "no rows matched the requested period range"}`,
      "no-usable-rows",
    );
  }

  // ── 5. Validate ─────────────────────────────────────────────────────────
  const { valid, rejected } = validatePermitStats(normalized.stats);
  base.recordsRejected = rejected.length;
  base.rejections = rejected;

  if (valid.length === 0) {
    return fail(
      `All ${normalized.stats.length} aggregated rows failed validation. First problem: ${rejected[0]?.message ?? "unknown"}`,
      "validation",
    );
  }

  // Batch-level checks catch faults invisible one row at a time — chiefly a
  // misread date column, whose signature is periods in the future. Refusing the
  // whole batch is right: if the parse is wrong, the rows that happen to look
  // sane are not trustworthy either.
  const anomaly = detectPermitBatchAnomaly(valid, {
    today: now().toISOString().slice(0, 7),
  });
  if (anomaly) return fail(anomaly, "batch-anomaly");

  // ── 6. Persist ──────────────────────────────────────────────────────────
  let written: number;
  try {
    written = await repository.upsertPermitStats(valid);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : String(error),
      "persistence",
    );
  }

  // ── 7. Record ───────────────────────────────────────────────────────────
  // Rejected rows make the run partial, not successful. A run that says
  // "success" while having discarded a tenth of the source is how a slow feed
  // regression goes unnoticed for months.
  const hadProblems = rejected.length > 0 || normalized.rejected.length > 0;
  const status: ImportRunStatus = hadProblems ? "partial" : "success";

  const result: CivicIngestResult = {
    ...base,
    status,
    recordsWritten: written,
    firstPeriod: valid[0].period,
    lastPeriod: valid[valid.length - 1].period,
    errorMessage: hadProblems ? describeProblems(normalized.rejected, rejected) : null,
    errorKind: hadProblems ? "partial-validation" : null,
    durationMs: now().getTime() - startedAt,
  };

  await importRuns.completeRun(runId, {
    status,
    recordsReceived: result.recordsReceived,
    recordsWritten: written,
    recordsRejected: normalized.rejected.length + rejected.length,
    errorMessage: result.errorMessage,
    errorKind: result.errorKind,
    metadata: {
      durationMs: result.durationMs,
      resourceId: result.resourceId,
      firstPeriod: result.firstPeriod,
      lastPeriod: result.lastPeriod,
      unknownBoroughs: result.unknownBoroughs,
      missingOptionalFields: result.missingOptionalFields,
    },
  });

  return result;
}

function describeProblems(
  rows: PermitRowRejection[],
  stats: ValidationIssue[],
): string {
  const parts: string[] = [];
  if (rows.length > 0) {
    const byReason = new Map<string, number>();
    for (const row of rows) byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
    const summary = [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${count} ${reason}`)
      .join(", ");
    parts.push(`${rows.length} source row(s) skipped (${summary}). First: ${rows[0].message}`);
  }
  if (stats.length > 0) {
    parts.push(
      `${stats.length} aggregated row(s) failed validation and were not written. First: ${stats[0].message}`,
    );
  }
  return parts.join(" ");
}

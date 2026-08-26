import type { ImportRun, ImportRunStatus } from "@/types";

/**
 * The audit trail for ingestion.
 *
 * Separate from the repositories on purpose: an import run is a fact about the
 * *pipeline*, not about the data it carried, and the market pipeline will need
 * exactly the same mechanism when it lands. Keeping it apart means one
 * implementation serves every source.
 *
 * This is the piece that makes silent failure impossible. A run opens before the
 * first byte is fetched and closes on the way out whatever happens, so a crashed
 * import leaves a `running` row that never completed rather than no trace at all
 * — and "no successful run since March" is a question the diagnostics endpoint
 * can actually answer.
 */

export interface StartRunInput {
  dataSourceId: string;
  triggeredBy: ImportRun["triggeredBy"];
  /** The URL fetched, the range requested — anything useful when debugging. */
  metadata?: Record<string, unknown>;
}

export interface CompleteRunInput {
  status: ImportRunStatus;
  /** Rows the publisher returned. */
  recordsReceived: number;
  /** Rows written to storage. */
  recordsWritten: number;
  /** Rows refused by validation. */
  recordsRejected: number;
  errorMessage?: string | null;
  /** Coarse failure class, for grouping alerts later. */
  errorKind?: string | null;
  metadata?: Record<string, unknown>;
}

/** Everything an operator needs to judge whether the pipeline is working. */
export interface ImportHealth {
  dataSourceId: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  lastFailureKind: string | null;
  /** Records written by the most recent successful run. */
  lastSuccessRecordsWritten: number | null;
  /** Consecutive failures since the last success. */
  consecutiveFailures: number;
  totalRuns: number;
}

export interface ImportRunStore {
  readonly name: string;
  startRun(input: StartRunInput): Promise<string>;
  completeRun(runId: string, input: CompleteRunInput): Promise<void>;
  listRuns(dataSourceId?: string, limit?: number): Promise<ImportRun[]>;
  getHealth(dataSourceId: string): Promise<ImportHealth>;
}

/**
 * In-memory store, used while no database is connected.
 *
 * Runs survive for the life of the process and no longer. That is a real
 * limitation and it is stated in the diagnostics response rather than left for
 * someone to discover — an audit trail that quietly evaporates on restart is
 * worse than none, because it looks like one.
 */
export class InMemoryImportRunStore implements ImportRunStore {
  readonly name = "In-memory (not persisted across restarts)";

  private runs: Array<ImportRun & { errorKind: string | null; recordsReceived: number; recordsRejected: number }> = [];
  private sequence = 0;

  async startRun(input: StartRunInput): Promise<string> {
    this.sequence += 1;
    const id = `run-mem-${this.sequence}`;
    this.runs.unshift({
      id,
      dataSourceId: input.dataSourceId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "running",
      recordsImported: 0,
      recordsReceived: 0,
      recordsRejected: 0,
      errorMessage: null,
      errorKind: null,
      triggeredBy: input.triggeredBy,
    });
    return id;
  }

  async completeRun(runId: string, input: CompleteRunInput): Promise<void> {
    const run = this.runs.find((entry) => entry.id === runId);
    if (!run) return;
    run.completedAt = new Date().toISOString();
    run.status = input.status;
    run.recordsImported = input.recordsWritten;
    run.recordsReceived = input.recordsReceived;
    run.recordsRejected = input.recordsRejected;
    run.errorMessage = input.errorMessage ?? null;
    run.errorKind = input.errorKind ?? null;
  }

  async listRuns(dataSourceId?: string, limit = 20): Promise<ImportRun[]> {
    return this.runs
      .filter((run) => !dataSourceId || run.dataSourceId === dataSourceId)
      .slice(0, limit);
  }

  async getHealth(dataSourceId: string): Promise<ImportHealth> {
    const runs = this.runs.filter((run) => run.dataSourceId === dataSourceId);
    return summariseHealth(dataSourceId, runs);
  }
}

/**
 * Turn a run history into a health summary.
 *
 * Shared by both stores so "what counts as healthy" is decided once. A `partial`
 * run counts as a success for freshness — data did land — while still being
 * visible as partial in the run list.
 */
export function summariseHealth(
  dataSourceId: string,
  runs: Array<
    Pick<ImportRun, "status" | "startedAt" | "completedAt" | "recordsImported" | "errorMessage"> & {
      errorKind?: string | null;
    }
  >,
): ImportHealth {
  const ordered = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const lastSuccess = ordered.find(
    (run) => run.status === "success" || run.status === "partial",
  );
  const lastFailure = ordered.find((run) => run.status === "failed");

  let consecutiveFailures = 0;
  for (const run of ordered) {
    if (run.status === "failed") consecutiveFailures += 1;
    else if (run.status === "success" || run.status === "partial") break;
  }

  return {
    dataSourceId,
    lastSuccessAt: lastSuccess?.completedAt ?? lastSuccess?.startedAt ?? null,
    lastFailureAt: lastFailure?.completedAt ?? lastFailure?.startedAt ?? null,
    lastFailureMessage: lastFailure?.errorMessage ?? null,
    lastFailureKind: lastFailure?.errorKind ?? null,
    lastSuccessRecordsWritten: lastSuccess?.recordsImported ?? null,
    consecutiveFailures,
    totalRuns: ordered.length,
  };
}

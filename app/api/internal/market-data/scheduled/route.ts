import type { BenchmarkSeriesCode } from "@/types/benchmark";
import { getBenchmarkRepository, getCivicRepository, getImportRunStore } from "@/lib/data";
import { BankOfCanadaConnector } from "@/lib/pipeline/connectors/bank-of-canada/client";
import {
  BANK_OF_CANADA_SOURCE_ID,
  SCHEDULED_BENCHMARK_SERIES,
} from "@/lib/pipeline/connectors/bank-of-canada/series";
import {
  IngestFailedError,
  ingestBankOfCanadaSeries,
  type IngestResult,
} from "@/lib/pipeline/ingest/bank-of-canada";
import { MontrealOpenDataConnector } from "@/lib/pipeline/connectors/montreal-open-data/client";
import { MONTREAL_PERMITS } from "@/lib/pipeline/connectors/montreal-open-data/datasets";
import {
  CivicIngestFailedError,
  ingestMontrealPermits,
  type CivicIngestResult,
} from "@/lib/pipeline/ingest/montreal-permits";
import { runPipelineMonitor, type PipelineScope } from "@/lib/pipeline/monitor";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { requireIngestAuth, unprotectedWarning } from "@/lib/api/ingest-auth";
import { describeValidationError, scheduledIngestSchema } from "@/lib/api/params";
import { getAttributions } from "@/lib/data";

/**
 * `GET|POST /api/internal/market-data/scheduled`
 *
 * The endpoint a scheduler calls. One request runs every scheduled import and
 * then evaluates monitoring, which is the whole of "operating unattended".
 *
 * ## Provider-neutral, deliberately
 *
 * Nothing here knows what is calling it. There is no n8n signature check, no
 * `x-vercel-cron` header, no GitHub Actions assumption — just a URL, a shared
 * secret, and a JSON response. That is what makes it work identically from a
 * Vercel Cron entry, an n8n Schedule node, a GitHub Actions workflow and a line
 * in `crontab`, and what stops a change of scheduler from becoming a change of
 * application code. docs/AUTOMATION.md shows all four.
 *
 * **Both verbs, on purpose.** Vercel Cron can only issue `GET`; n8n and cron
 * default to `POST`. Refusing either would tie the application to a provider
 * through the back door. `GET` reads its options from the query string, `POST`
 * from a JSON body; both are optional, and the defaults are what you want.
 *
 * ```
 * curl -X POST https://…/api/internal/market-data/scheduled \
 *   -H "Authorization: Bearer $MARKET_INGEST_SECRET"
 * ```
 *
 * ## No pipeline logic lives here
 *
 * This route calls `ingestBankOfCanadaSeries` and `ingestMontrealPermits` — the
 * same functions the manual endpoints and the tests call. It contains no
 * fetching, no normalization, no validation and no writes. A second copy of a
 * pipeline behind a scheduler is a second copy to fix when the upstream
 * changes, and the one nobody remembers.
 *
 * ## Two pipelines, one call
 *
 * `?pipelines=benchmarks,civic` selects which run; both by default. A scheduler
 * needing different cadences — the bond yield is daily, permits are monthly —
 * points two cron entries at the same URL with different `pipelines` values
 * rather than at two endpoints. The monitor is then scoped to whatever actually
 * ran, so a benchmarks-only execution cannot close an open civic incident.
 *
 * ## Why a failed import still returns 200
 *
 * A failure is *reported*, not signalled by the status code: the run is recorded
 * in the audit trail, the monitor raises an incident, and the body carries
 * `ok: false` with the reason. Returning 5xx would make most schedulers retry
 * immediately — hammering an upstream that is already failing, and multiplying
 * one incident into a dozen. The status code answers "did the scheduler reach
 * the application?", which is the only thing a scheduler can usefully act on.
 * `ok` in the body answers "did the data arrive", and that is what monitoring
 * watches.
 */

interface SeriesOutcome {
  seriesCode: BenchmarkSeriesCode;
  ok: boolean;
  status: IngestResult["status"];
  runId: string;
  recordsReceived: number;
  recordsWritten: number;
  recordsRejected: number;
  recordsSkipped: number;
  firstObservationDate: string | null;
  lastObservationDate: string | null;
  errorKind: string | null;
  errorMessage: string | null;
  durationMs: number;
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  return handle(request, raw ?? {});
}

export async function GET(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  return handle(request, query);
}

async function handle(request: Request, input: unknown) {
  return withErrorHandling(async () => {
    const denied = requireIngestAuth(request);
    if (denied) return denied;

    const parsed = scheduledIngestSchema.safeParse(input);
    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }
    const { series, recent, notify, pipelines } = parsed.data;
    const scopes = pipelines as PipelineScope[];

    const seriesCodes = series
      ? ([series] as BenchmarkSeriesCode[])
      : [...SCHEDULED_BENCHMARK_SERIES];

    const outcomes: SeriesOutcome[] = [];
    const civic: CivicOutcome[] = [];

    if (scopes.includes("benchmarks")) {
      // Dependencies are constructed once and shared, so a multi-series run
      // reuses one connector rather than opening a client per series.
      const dependencies = {
        connector: new BankOfCanadaConnector(),
        repository: getBenchmarkRepository(),
        importRuns: getImportRunStore(),
      };

      for (const seriesCode of seriesCodes) {
        // Sequential, not `Promise.all`. Scheduled imports are not latency-
        // sensitive, one series failing must not abort the others, and a
        // scheduled job should not open several simultaneous connections to a
        // public publisher that is doing us a favour by being free.
        outcomes.push(await ingestOne(seriesCode, recent, dependencies));
      }
    }

    if (scopes.includes("civic")) {
      civic.push(await ingestCivic());
    }

    // Monitoring runs whatever happened above, including when every import
    // succeeded: that is what closes an incident and sends the recovery notice.
    // Scoped to the pipelines that actually ran — assessing one must never
    // resolve another's incident.
    const monitor = await runPipelineMonitor({ notify, seriesCodes, scopes });

    const warning = unprotectedWarning(request);
    const ok =
      outcomes.every((outcome) => outcome.ok) && civic.every((outcome) => outcome.ok);

    return apiSuccess(
      {
        ok,
        triggeredBy: "schedule" as const,
        pipelines: scopes,
        window: { recent },
        series: outcomes,
        civic,
        monitor: {
          overall: monitor.overall,
          reports: monitor.reports,
          alerts: monitor.alerts,
          suppressed: monitor.suppressed,
          openIncidents: monitor.openIncidents.map((incident) => incident.incidentKey),
          deliveries: monitor.deliveries,
          alerting: monitor.alerting,
        },
        ...(warning ? { warning } : {}),
      },
      {
        period:
          outcomes.find((outcome) => outcome.lastObservationDate)?.lastObservationDate ??
          new Date().toISOString().slice(0, 10),
        sources: getAttributions([BANK_OF_CANADA_SOURCE_ID]),
        dataQuality: getBenchmarkRepository().dataQuality,
      },
    );
  });
}

/**
 * Run one series and flatten both outcomes into the same shape.
 *
 * `IngestFailedError` already carries a complete `IngestResult`, so a failure
 * reports exactly the same fields as a success — counts, run id, timings — and a
 * caller never has to branch on the shape to find out what happened.
 */
async function ingestOne(
  seriesCode: BenchmarkSeriesCode,
  recent: number,
  dependencies: Parameters<typeof ingestBankOfCanadaSeries>[1],
): Promise<SeriesOutcome> {
  try {
    const result = await ingestBankOfCanadaSeries(
      { seriesCode, recent, triggeredBy: "schedule" },
      dependencies,
    );
    return { ...toOutcome(result), ok: result.status !== "failed" };
  } catch (error) {
    if (error instanceof IngestFailedError) {
      return { ...toOutcome(error.result), ok: false };
    }
    throw error;
  }
}

function toOutcome(result: IngestResult): Omit<SeriesOutcome, "ok"> {
  return {
    seriesCode: result.seriesCode,
    status: result.status,
    runId: result.runId,
    recordsReceived: result.recordsReceived,
    recordsWritten: result.recordsWritten,
    recordsRejected: result.recordsRejected,
    recordsSkipped: result.recordsSkipped,
    firstObservationDate: result.firstObservationDate,
    lastObservationDate: result.lastObservationDate,
    errorKind: result.errorKind,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
  };
}

/* ── Civic ────────────────────────────────────────────────────────────────── */

interface CivicOutcome {
  datasetCode: string;
  ok: boolean;
  status: CivicIngestResult["status"];
  runId: string;
  recordsReceived: number;
  recordsWritten: number;
  recordsRejected: number;
  unknownBoroughs: string[];
  firstPeriod: string | null;
  lastPeriod: string | null;
  errorKind: string | null;
  errorMessage: string | null;
  durationMs: number;
}

/**
 * Run the civic import and flatten both outcomes into the same shape.
 *
 * `CivicIngestFailedError` already carries a complete result, so a failure
 * reports the same fields as a success — counts, run id, timings — and a caller
 * never has to branch on the shape to find out what happened.
 */
async function ingestCivic(): Promise<CivicOutcome> {
  const dependencies = {
    connector: new MontrealOpenDataConnector(),
    repository: getCivicRepository(),
    importRuns: getImportRunStore(),
  };

  try {
    const result = await ingestMontrealPermits(
      { dataset: MONTREAL_PERMITS, triggeredBy: "schedule" },
      dependencies,
    );
    return { ...toCivicOutcome(result), ok: result.status !== "failed" };
  } catch (error) {
    if (error instanceof CivicIngestFailedError) {
      return { ...toCivicOutcome(error.result), ok: false };
    }
    throw error;
  }
}

function toCivicOutcome(result: CivicIngestResult): Omit<CivicOutcome, "ok"> {
  return {
    datasetCode: result.datasetCode,
    status: result.status,
    runId: result.runId,
    recordsReceived: result.recordsReceived,
    recordsWritten: result.recordsWritten,
    recordsRejected: result.recordsRejected,
    unknownBoroughs: result.unknownBoroughs,
    firstPeriod: result.firstPeriod,
    lastPeriod: result.lastPeriod,
    errorKind: result.errorKind,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
  };
}

import { getCivicRepository, getImportRunStore } from "@/lib/data";
import { MontrealOpenDataConnector } from "@/lib/pipeline/connectors/montreal-open-data/client";
import {
  MONTREAL_PERMITS,
  getDataset,
} from "@/lib/pipeline/connectors/montreal-open-data/datasets";
import {
  CivicIngestFailedError,
  ingestMontrealPermits,
} from "@/lib/pipeline/ingest/montreal-permits";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { requireIngestAuth, unprotectedWarning } from "@/lib/api/ingest-auth";
import { describeValidationError, montrealPermitsIngestSchema } from "@/lib/api/params";
import { getAttributions } from "@/lib/data";

/**
 * `POST /api/internal/market-data/montreal-permits`
 *
 * Triggers one civic ingest run. Like its Bank of Canada counterpart, the route
 * contains no pipeline — it validates a body, calls `ingestMontrealPermits`, and
 * shapes the result. The pipeline is a plain function so a scheduler and the
 * tests run exactly the same code with no HTTP server in the way.
 *
 * Body (every field optional):
 * ```jsonc
 * { "from": "2024-01", "to": "2026-06", "maxRecords": 50000 }
 * ```
 *
 * ## Authentication
 *
 * `Authorization: Bearer $MARKET_INGEST_SECRET`, checked before the body is
 * read. See docs/AUTOMATION.md §2.
 */
export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const denied = requireIngestAuth(request);
    if (denied) return denied;

    const raw = await request.json().catch(() => null);
    const parsed = montrealPermitsIngestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }
    const body = parsed.data;

    const dataset = getDataset(body.dataset ?? MONTREAL_PERMITS.code);
    if (!dataset) {
      return apiError("NOT_FOUND", `Unknown dataset "${body.dataset}".`);
    }

    try {
      const result = await ingestMontrealPermits(
        {
          dataset,
          from: body.from,
          to: body.to,
          maxRecords: body.maxRecords,
          triggeredBy: body.triggeredBy,
        },
        {
          connector: new MontrealOpenDataConnector(),
          repository: getCivicRepository(),
          importRuns: getImportRunStore(),
        },
      );

      const warning = unprotectedWarning(request);
      return apiSuccess(warning ? { ...result, warning } : result, {
        period: result.lastPeriod ?? new Date().toISOString().slice(0, 7),
        sources: getAttributions([dataset.sourceId]),
        dataQuality: getCivicRepository().dataQuality,
      });
    } catch (error) {
      if (error instanceof CivicIngestFailedError) {
        // A failed ingest is a reported outcome, not a crash: the run is already
        // recorded and the caller gets the statistics and the reason. The
        // message comes from our own error classes — never a stack trace.
        return apiError("INTERNAL_ERROR", error.message, {
          runId: error.result.runId,
          errorKind: error.result.errorKind,
          datasetCode: error.result.datasetCode,
          resourceId: error.result.resourceId,
          recordsReceived: error.result.recordsReceived,
          recordsWritten: error.result.recordsWritten,
          recordsRejected: error.result.recordsRejected,
          unknownBoroughs: error.result.unknownBoroughs,
          requestUrl: error.result.requestUrl,
          durationMs: error.result.durationMs,
        });
      }
      throw error;
    }
  });
}

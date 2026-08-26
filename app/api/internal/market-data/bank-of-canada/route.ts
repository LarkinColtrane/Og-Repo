import type { BenchmarkSeriesCode } from "@/types/benchmark";
import { getBenchmarkRepository, getImportRunStore } from "@/lib/data";
import { BankOfCanadaConnector } from "@/lib/pipeline/connectors/bank-of-canada/client";
import {
  IngestFailedError,
  ingestBankOfCanadaSeries,
} from "@/lib/pipeline/ingest/bank-of-canada";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { bankOfCanadaIngestSchema, describeValidationError } from "@/lib/api/params";
import { getAttributions } from "@/lib/data";
import { BANK_OF_CANADA_SOURCE_ID } from "@/lib/pipeline/connectors/bank-of-canada/series";

/**
 * POST /api/internal/market-data/bank-of-canada
 *
 * Triggers one ingest run. The route does **not** contain the pipeline — it
 * validates a body, calls `ingestBankOfCanadaSeries`, and shapes the result.
 * The pipeline itself is a plain function so a scheduler and the tests can run
 * exactly the same code without an HTTP server in the way.
 *
 * Body:
 * ```jsonc
 * { "series": "5y-canada-bond", "startDate": "2021-01-01", "endDate": "2026-08-26" }
 * // or
 * { "series": "5y-canada-bond", "recent": 30 }
 * ```
 *
 * ⚠️ **Unauthenticated, by decision.** This project has no auth system, and
 * `19.` of the brief rules out inventing one for a single endpoint. The route is
 * namespaced under `/api/internal/` so the boundary is obvious, and adding a
 * check is a three-line edit at the top of this handler:
 *
 * ```ts
 * if (!isAuthorised(request)) return apiError("INVALID_REQUEST", "Unauthorized.");
 * ```
 *
 * with `isAuthorised` doing a constant-time comparison against `IMPORT_API_KEY` —
 * the same shape already documented in docs/DATA_PIPELINE.md §7. Until that
 * exists, **this endpoint must not be reachable from the public internet**: it
 * can drive unbounded outbound requests to the Bank of Canada. See
 * docs/BANK_OF_CANADA.md § Authentication.
 */
export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const raw = await request.json().catch(() => null);
    if (raw === null) {
      return apiError("INVALID_REQUEST", "Request body must be JSON.");
    }

    const parsed = bankOfCanadaIngestSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }

    const body = parsed.data;

    try {
      const result = await ingestBankOfCanadaSeries(
        {
          seriesCode: body.series as BenchmarkSeriesCode,
          startDate: body.startDate,
          endDate: body.endDate,
          recent: body.recent,
          triggeredBy: body.triggeredBy,
        },
        {
          connector: new BankOfCanadaConnector(),
          repository: getBenchmarkRepository(),
          importRuns: getImportRunStore(),
        },
      );

      return apiSuccess(result, {
        period: result.lastObservationDate ?? new Date().toISOString().slice(0, 10),
        sources: getAttributions([BANK_OF_CANADA_SOURCE_ID]),
        dataQuality: getBenchmarkRepository().dataQuality,
      });
    } catch (error) {
      if (error instanceof IngestFailedError) {
        // A failed ingest is a reported outcome, not a crash: the run is already
        // recorded, and the caller gets the statistics and the reason. The
        // message comes from our own error classes — an upstream status, a
        // validation summary — never a stack trace.
        return apiError("INTERNAL_ERROR", error.message, {
          runId: error.result.runId,
          errorKind: error.result.errorKind,
          seriesCode: error.result.seriesCode,
          recordsReceived: error.result.recordsReceived,
          recordsWritten: error.result.recordsWritten,
          recordsRejected: error.result.recordsRejected,
          requestUrl: error.result.requestUrl,
          durationMs: error.result.durationMs,
        });
      }
      throw error;
    }
  });
}

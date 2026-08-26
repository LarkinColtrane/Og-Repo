import type { BenchmarkSeriesCode } from "@/types/benchmark";
import { getBenchmarkRepository, getImportRunStore } from "@/lib/data";
import { BankOfCanadaConnector } from "@/lib/pipeline/connectors/bank-of-canada/client";
import {
  IngestFailedError,
  ingestBankOfCanadaSeries,
} from "@/lib/pipeline/ingest/bank-of-canada";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { requireIngestAuth, unprotectedWarning } from "@/lib/api/ingest-auth";
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
 * ## Authentication
 *
 * Protected by a shared secret. Send:
 *
 * ```
 * Authorization: Bearer $MARKET_INGEST_SECRET
 * ```
 *
 * Missing, malformed or incorrect credentials get a 401 and the pipeline is
 * never touched — the check runs before the body is even read, so an
 * unauthenticated caller cannot make this process contact the Bank of Canada.
 * With no secret configured the endpoint fails closed in production and runs
 * unprotected (with a warning in the response) in development. See
 * `lib/api/ingest-auth.ts` and docs/AUTOMATION.md.
 */
export async function POST(request: Request) {
  return withErrorHandling(async () => {
    // Before anything else — before the body is parsed, before a connector is
    // constructed. An unauthorised request must cost this server nothing and
    // must never reach an upstream publisher.
    const denied = requireIngestAuth(request);
    if (denied) return denied;

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

      const warning = unprotectedWarning(request);

      return apiSuccess(warning ? { ...result, warning } : result, {
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

import { BENCHMARK_SERIES_CODES } from "@/types/benchmark";
import { getBenchmarkRepository, getImportRunStore } from "@/lib/data";
import { getBenchmarkSnapshot } from "@/lib/data/benchmark-service";
import { apiSuccess, withErrorHandling } from "@/lib/api/response";
import {
  authoriseIngest,
  requireIngestAuth,
} from "@/lib/api/ingest-auth";
import { getAttributions } from "@/lib/data";
import { BANK_OF_CANADA_SOURCE_ID } from "@/lib/pipeline/connectors/bank-of-canada/series";

/**
 * GET /api/internal/market-data/status
 *
 * Pipeline diagnostics: for each benchmark series, how fresh the data is and how
 * the last few imports went.
 *
 * This exists so a pipeline cannot fail quietly. Without it, a broken import is
 * invisible until somebody notices the chart has stopped moving — which, for a
 * series that legitimately sits flat for days, could be weeks.
 *
 * ## Authentication
 *
 * Protected by the same shared secret as the ingest endpoint:
 * `Authorization: Bearer $MARKET_INGEST_SECRET`. Operational metadata — run
 * timestamps, error messages, upstream request URLs — is not market data and
 * has no business being public. The response reports its own protection state
 * so an operator can confirm the check is actually on.
 */
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const denied = requireIngestAuth(request);
    if (denied) return denied;

    const auth = authoriseIngest(request);
    const repository = getBenchmarkRepository();
    const importRuns = getImportRunStore();

    const series = await Promise.all(
      BENCHMARK_SERIES_CODES.map(async (code) => {
        const snapshot = await getBenchmarkSnapshot(code);
        return {
          seriesCode: code,
          upstreamCode: snapshot.series.upstreamCode,
          freshness: snapshot.freshness,
          businessDayLag: snapshot.businessDayLag,
          maxBusinessDayLag: snapshot.series.maxBusinessDayLag,
          latestObservationDate: snapshot.latest?.observationDate ?? null,
          latestValue: snapshot.latest?.value ?? null,
          dataQuality: snapshot.latest?.dataQuality ?? null,
        };
      }),
    );

    const health = await importRuns.getHealth(BANK_OF_CANADA_SOURCE_ID);
    const recentRuns = await importRuns.listRuns(BANK_OF_CANADA_SOURCE_ID, 10);

    return apiSuccess(
      {
        store: {
          benchmarks: repository.name,
          importRuns: importRuns.name,
          /** True when neither the data nor the audit trail survives a restart. */
          ephemeral: repository.dataQuality === "demo",
        },
        series,
        health,
        recentRuns,
        authentication: {
          enabled: auth.outcome !== "unprotected",
          /**
           * Present only when the endpoint is running without a configured
           * secret, which the guard permits outside production. Stating it in
           * the payload means a misconfigured deployment announces itself
           * instead of looking identical to a protected one.
           */
          warning: auth.outcome === "unprotected" ? auth.message : null,
        },
      },
      {
        period: series[0]?.latestObservationDate ?? new Date().toISOString().slice(0, 10),
        sources: getAttributions([BANK_OF_CANADA_SOURCE_ID]),
        dataQuality: repository.dataQuality,
      },
    );
  });
}

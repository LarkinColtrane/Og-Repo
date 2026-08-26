import { BENCHMARK_SERIES_CODES } from "@/types/benchmark";
import { getBenchmarkRepository, getImportRunStore } from "@/lib/data";
import { getBenchmarkSnapshot } from "@/lib/data/benchmark-service";
import { apiSuccess, withErrorHandling } from "@/lib/api/response";
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
 * ⚠️ **Unauthenticated.** The project has no auth system and inventing one for a
 * single endpoint would be worse than the gap it closes. It exposes operational
 * metadata — run timestamps, record counts, error messages — and no market data
 * that `/api/market/benchmarks` does not already serve publicly. Before this is
 * deployed anywhere public it needs the same shared-secret check documented for
 * the ingest endpoint. See docs/BANK_OF_CANADA.md § Authentication.
 */
export async function GET() {
  return withErrorHandling(async () => {
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
          enabled: false,
          note: "This endpoint is unauthenticated. It must not be exposed publicly without the shared-secret check described in docs/BANK_OF_CANADA.md.",
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

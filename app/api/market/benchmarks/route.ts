import type { BenchmarkRange, BenchmarkSeriesCode } from "@/types/benchmark";
import { getAttributions } from "@/lib/data";
import { getBenchmarkPayload } from "@/lib/data/benchmark-service";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import {
  benchmarkQuerySchema,
  describeValidationError,
  parseSearchParams,
} from "@/lib/api/params";

/**
 * GET /api/market/benchmarks
 *
 * Query: `?series=5y-canada-bond&range=1y`
 *
 * Returns the latest observation, the history for the range, and everything
 * needed to judge how much to trust it: freshness, business-day lag, and when an
 * import last succeeded or failed.
 *
 * `dataQuality` comes from the benchmark repository rather than the market one —
 * a live bond yield beside demo rents is a real and expected state, and the
 * response has to be able to say so.
 */
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const parsed = parseSearchParams(request.url, benchmarkQuerySchema);

    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }

    const payload = await getBenchmarkPayload(
      parsed.data.series as BenchmarkSeriesCode,
      parsed.data.range as BenchmarkRange,
    );

    if (!payload.snapshot.latest) {
      return apiError(
        "NOT_FOUND",
        `No observations on record for "${parsed.data.series}". Run an import first — see docs/BANK_OF_CANADA.md.`,
      );
    }

    return apiSuccess(payload, {
      // The reporting period for a daily series is the observation date itself.
      period: payload.snapshot.latest.observationDate,
      sources: getAttributions([payload.snapshot.latest.source]),
      dataQuality: payload.snapshot.latest.dataQuality,
      // Short: a benchmark that publishes daily is worth re-reading often, and a
      // stale quote here would undermine the freshness reporting beside it.
      maxAge: 300,
    });
  });
}

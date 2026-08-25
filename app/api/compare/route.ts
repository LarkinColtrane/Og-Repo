import { getRepository, getAttributions } from "@/lib/data";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import {
  compareQuerySchema,
  describeValidationError,
  parseSearchParams,
} from "@/lib/api/params";
import { DEMO_RENT_SOURCE_ID, DEMO_SALE_SOURCE_ID } from "@/data/demo/sources";

/**
 * GET /api/compare?slugs=plateau-mont-royal,verdun,villeray
 *
 * Up to four neighbourhoods, aligned on the latest common period. The cap is
 * enforced in the schema rather than in the UI, so the limit holds no matter who
 * is calling.
 */
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const parsed = parseSearchParams(request.url, compareQuerySchema);

    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }

    const repository = getRepository();
    const rows = await repository.getComparison(parsed.data.slugs);

    if (rows.length === 0) {
      return apiError(
        "NOT_FOUND",
        "None of the requested neighbourhoods are tracked yet.",
      );
    }

    return apiSuccess(rows, {
      period: await repository.getLatestPeriod(),
      sources: getAttributions([
        DEMO_SALE_SOURCE_ID,
        DEMO_RENT_SOURCE_ID,
        "src-derived-metrics",
      ]),
      maxAge: 3600,
    });
  });
}

import type { PropertyType } from "@/types";
import { getRepository, getAttributions } from "@/lib/data";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import {
  describeValidationError,
  parseSearchParams,
  resolveDateBounds,
  saleStatsQuerySchema,
} from "@/lib/api/params";

/**
 * GET /api/neighbourhoods/[slug]/sales
 *
 * Query: `?propertyType=condo&range=3y` — or explicit `from`/`to` periods.
 * This is the endpoint the price-trend chart calls every time a filter changes.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return withErrorHandling(async () => {
    const { slug } = await params;
    const parsed = parseSearchParams(request.url, saleStatsQuerySchema);

    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }

    const repository = getRepository();
    const neighbourhood = await repository.getNeighbourhood(slug);
    if (!neighbourhood) {
      return apiError("NOT_FOUND", `No neighbourhood matches "${slug}".`);
    }

    const latestPeriod = await repository.getLatestPeriod();
    const bounds = resolveDateBounds(latestPeriod, parsed.data);

    const stats = await repository.getSaleStats({
      neighbourhoodSlug: slug,
      propertyType: parsed.data.propertyType as PropertyType | undefined,
      ...bounds,
    });

    return apiSuccess(stats, {
      period: latestPeriod,
      sources: getAttributions(stats.map((row) => row.dataSourceId)),
      maxAge: 3600,
    });
  });
}

import type { BedroomType } from "@/types";
import { getRepository, getAttributions } from "@/lib/data";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import {
  describeValidationError,
  parseSearchParams,
  rentalStatsQuerySchema,
  resolveDateBounds,
} from "@/lib/api/params";

/**
 * GET /api/neighbourhoods/[slug]/rent
 *
 * Query: `?bedroomType=twoBedroom&range=5y` — or explicit `from`/`to` periods.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return withErrorHandling(async () => {
    const { slug } = await params;
    const parsed = parseSearchParams(request.url, rentalStatsQuerySchema);

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

    const stats = await repository.getRentalStats({
      neighbourhoodSlug: slug,
      bedroomType: parsed.data.bedroomType as BedroomType | undefined,
      ...bounds,
    });

    return apiSuccess(stats, {
      period: latestPeriod,
      sources: getAttributions(stats.map((row) => row.dataSourceId)),
      maxAge: 3600,
    });
  });
}

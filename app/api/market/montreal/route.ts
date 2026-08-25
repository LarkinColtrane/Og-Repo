import { getRepository, getAttributions } from "@/lib/data";
import { apiSuccess, withErrorHandling } from "@/lib/api/response";
import { DEMO_RENT_SOURCE_ID, DEMO_SALE_SOURCE_ID } from "@/data/demo/sources";

/**
 * GET /api/market/montreal
 *
 * The city-wide roll-up behind the homepage snapshot. Every headline figure here
 * is aggregated from neighbourhood statistics — see lib/calculations/aggregate.ts
 * for what "median" means once it is a median of medians.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const repository = getRepository();
    const overview = await repository.getCityOverview();

    return apiSuccess(overview, {
      period: overview.period,
      sources: getAttributions([
        DEMO_SALE_SOURCE_ID,
        DEMO_RENT_SOURCE_ID,
        "src-derived-metrics",
      ]),
      maxAge: 3600,
    });
  });
}

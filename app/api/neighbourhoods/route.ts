import { getRepository, getAttributions } from "@/lib/data";
import { apiSuccess, withErrorHandling } from "@/lib/api/response";
import { DEMO_SALE_SOURCE_ID } from "@/data/demo/sources";

/**
 * GET /api/neighbourhoods
 *
 * Reference data only — names, slugs, boroughs, coordinates. Statistics live under
 * the per-neighbourhood routes, so a component that just needs to populate a
 * selector does not pull a few thousand rows of history with it.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const repository = getRepository();
    const [neighbourhoods, period] = await Promise.all([
      repository.listNeighbourhoods(),
      repository.getLatestPeriod(),
    ]);

    return apiSuccess(neighbourhoods, {
      period,
      sources: getAttributions([DEMO_SALE_SOURCE_ID]),
      maxAge: 3600,
    });
  });
}

import { getRepository, getAttributions } from "@/lib/data";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { DEMO_RENT_SOURCE_ID, DEMO_SALE_SOURCE_ID } from "@/data/demo/sources";

/**
 * GET /api/neighbourhoods/[slug]
 *
 * The full dashboard snapshot: latest sale and rental statistics, the computed
 * market condition with its factors, and the generated summary. One request is
 * enough to render a dashboard.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return withErrorHandling(async () => {
    const { slug } = await params;
    const snapshot = await getRepository().getSnapshot(slug);

    if (!snapshot) {
      return apiError("NOT_FOUND", `No neighbourhood matches "${slug}".`);
    }

    return apiSuccess(snapshot, {
      period: snapshot.period,
      sources: getAttributions([
        DEMO_SALE_SOURCE_ID,
        DEMO_RENT_SOURCE_ID,
        "src-derived-metrics",
      ]),
      maxAge: 3600,
    });
  });
}

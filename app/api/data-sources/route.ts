import { getRepository, getAttributions } from "@/lib/data";
import { apiSuccess, withErrorHandling } from "@/lib/api/response";

/**
 * GET /api/data-sources
 *
 * The provenance registry: what is connected, what is planned, and when each was
 * last refreshed. Exposed as an endpoint rather than kept internal because it is
 * the thing an automated import would update, and a monitoring job should be able
 * to read it.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const repository = getRepository();
    const [sources, period] = await Promise.all([
      repository.listDataSources(),
      repository.getLatestPeriod(),
    ]);

    return apiSuccess(sources, {
      period,
      sources: getAttributions(sources.map((source) => source.id)),
      maxAge: 600,
    });
  });
}

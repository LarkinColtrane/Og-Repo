import { getMortgageRateRepository, getAttributions } from "@/lib/data";
import { apiSuccess, withErrorHandling } from "@/lib/api/response";
import { DEMO_RATE_SOURCE_ID } from "@/data/demo/lenders";

/**
 * GET /api/mortgage/lenders
 *
 * Reference data only — the institutions this platform compares. Rates live
 * under /api/mortgage/rates so a component that only needs to populate a
 * selector does not pull a hundred rate rows with it.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const repository = getMortgageRateRepository();
    const [lenders, effectiveDate] = await Promise.all([
      repository.listLenders(),
      repository.getLatestEffectiveDate(),
    ]);

    return apiSuccess(lenders, {
      period: effectiveDate,
      sources: getAttributions([DEMO_RATE_SOURCE_ID]),
      dataQuality: repository.dataQuality,
      maxAge: 3600,
    });
  });
}

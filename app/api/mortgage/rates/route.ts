import type { BorrowerProfile, MortgageProductType } from "@/types/mortgage";
import { getMortgageRateRepository, getAttributions } from "@/lib/data";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import {
  describeValidationError,
  mortgageRatesQuerySchema,
  parseSearchParams,
} from "@/lib/api/params";

/**
 * GET /api/mortgage/rates
 *
 * Query: `?productType=fixed&termYears=5` — optionally `lenderId` and
 * `borrowerProfile`. This is what the investor page calls when the term or
 * product changes.
 *
 * Note the cache window is short. Rates move daily and a stale quote is worse
 * than a slow one, so this deliberately does not get the hour-long window the
 * monthly market statistics use.
 */
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const parsed = parseSearchParams(request.url, mortgageRatesQuerySchema);

    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }

    const repository = getMortgageRateRepository();
    const rates = await repository.listRates({
      lenderId: parsed.data.lenderId,
      productType: parsed.data.productType as MortgageProductType | undefined,
      termYears: parsed.data.termYears,
      borrowerProfile: parsed.data.borrowerProfile as BorrowerProfile | undefined,
    });

    if (rates.length === 0) {
      return apiError(
        "NOT_FOUND",
        "No rates on record for that combination of product, term and profile.",
      );
    }

    return apiSuccess(rates, {
      period: await repository.getLatestEffectiveDate(),
      sources: getAttributions(rates.map((rate) => rate.dataSourceId)),
      dataQuality: repository.dataQuality,
      maxAge: 300,
    });
  });
}

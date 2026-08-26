import type { MortgageProductType, OccupancyType } from "@/types/mortgage";
import { getMortgageRateRepository, getAttributions } from "@/lib/data";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import {
  describeValidationError,
  mortgageCompareQuerySchema,
  parseSearchParams,
} from "@/lib/api/params";
import {
  buildFinancingMatrix,
  compareLenders,
  type FinancingMatrix,
  type LenderComparison,
} from "@/lib/calculations/financing";
import { DEMO_RATE_SOURCE_ID } from "@/data/demo/lenders";

/** The comparison payload, shared with the browser client. */
export interface MortgageComparePayload {
  comparison: LenderComparison;
  matrix: FinancingMatrix;
}

/** Down-payment levels the matrix always shows, eligible or not. */
const MATRIX_LEVELS = [5, 10, 20];

/**
 * GET /api/mortgage/compare
 *
 * Query: `?price=725000&downPaymentPercent=20&occupancy=investment&units=3`
 *
 * Runs the full lender comparison and the lender × down-payment matrix
 * server-side and returns both.
 *
 * The investor page computes the same thing locally so that dragging a slider is
 * instant rather than a request per frame — but it computes it by calling
 * `compareLenders` and `buildFinancingMatrix`, the *same* functions this route
 * calls. One implementation, two callers, so the two can never drift apart. This
 * endpoint exists for everything that is not that page: a script, a notebook, a
 * future n8n workflow, or anyone wanting to check the arithmetic with curl.
 */
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const parsed = parseSearchParams(request.url, mortgageCompareQuerySchema);

    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }

    const query = parsed.data;
    const repository = getMortgageRateRepository();

    const [lenders, rates, effectiveDate] = await Promise.all([
      repository.listLenders(),
      // Both borrower profiles: the matrix needs insured pricing for the 5% and
      // 10% columns and uninsured for 20%, in one pass.
      repository.listRates({
        productType: query.productType as MortgageProductType,
        termYears: query.termYears,
      }),
      repository.getLatestEffectiveDate(),
    ]);

    if (rates.length === 0) {
      return apiError(
        "NOT_FOUND",
        `No rates on record for a ${query.termYears}-year ${query.productType} product.`,
      );
    }

    const baseInput = {
      purchasePrice: query.price,
      amortizationYears: query.amortizationYears,
      termYears: query.termYears,
      occupancy: query.occupancy as OccupancyType,
      units: query.units,
    };

    const payload: MortgageComparePayload = {
      comparison: compareLenders({
        input: { ...baseInput, downPaymentPercent: query.downPaymentPercent },
        lenders,
        rates,
      }),
      matrix: buildFinancingMatrix({
        input: baseInput,
        downPaymentPercents: MATRIX_LEVELS,
        lenders,
        rates,
      }),
    };

    return apiSuccess(payload, {
      period: effectiveDate,
      sources: getAttributions([DEMO_RATE_SOURCE_ID]),
      dataQuality: repository.dataQuality,
      maxAge: 300,
    });
  });
}

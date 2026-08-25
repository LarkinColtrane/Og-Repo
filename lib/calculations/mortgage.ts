/**
 * Canadian mortgage mathematics.
 *
 * These calculations are real and are not affected by the demo dataset — the
 * market numbers may be synthetic, but a payment computed here is the payment.
 *
 * Two details that make this Canadian rather than generic:
 *
 *  1. **Semi-annual compounding.** Fixed-rate Canadian mortgages compound twice a
 *     year, not monthly (Interest Act, s. 6). The effective monthly rate is
 *     therefore `(1 + annual/2)^(1/6) − 1`, which is slightly below `annual/12`.
 *     Using the American convention overstates the payment by a few dollars a
 *     month — small, but wrong.
 *  2. **Mortgage default insurance.** Below a 20% down payment, insurance is
 *     mandatory and its premium is added to the borrowed principal rather than
 *     paid up front.
 */

/** Premium rates by loan-to-value band, as a fraction of the loan amount. */
export const MORTGAGE_INSURANCE_RATES = [
  { maxLoanToValue: 0.95, rate: 0.04 },
  { maxLoanToValue: 0.9, rate: 0.031 },
  { maxLoanToValue: 0.85, rate: 0.028 },
  { maxLoanToValue: 0.8, rate: 0.024 },
] as const;

/**
 * Minimum down payment rules: 5% on the first $500,000, 10% on the portion between
 * $500,000 and $1,500,000, and 20% on any purchase above $1,500,000.
 */
export const DOWN_PAYMENT_TIERS = {
  firstTierCap: 500_000,
  secondTierCap: 1_500_000,
  firstTierRate: 0.05,
  secondTierRate: 0.1,
  highValueRate: 0.2,
} as const;

/**
 * These rules and premium rates reflect published federal policy as of this date.
 * They change; re-check before relying on the output. Kept as a constant so the
 * UI can display it rather than implying the figures are permanent.
 */
export const MORTGAGE_RULES_LAST_REVIEWED = "2026-01";

export interface MortgageInput {
  /** Purchase price in dollars. */
  purchasePrice: number;
  /** Down payment in dollars. */
  downPayment: number;
  /** Nominal annual interest rate as a percentage, e.g. 4.79. */
  interestRate: number;
  /** Amortization period in years. */
  amortizationYears: number;
}

export interface MortgageResult {
  purchasePrice: number;
  downPayment: number;
  downPaymentPercent: number;
  /** Price minus down payment, before insurance. */
  baseLoanAmount: number;
  /** Premium added to the loan when the down payment is under 20%. */
  insurancePremium: number;
  /** What is actually borrowed: base loan plus any insurance premium. */
  totalLoanAmount: number;
  monthlyPayment: number;
  /** Effective monthly rate after converting from semi-annual compounding. */
  effectiveMonthlyRate: number;
  totalInterestOverTerm: number;
  totalPaid: number;
  /** Rule violations and things the user should know, in plain language. */
  warnings: string[];
}

/** Minimum legal down payment for a given price. */
export function minimumDownPayment(purchasePrice: number): number {
  const t = DOWN_PAYMENT_TIERS;
  if (purchasePrice <= 0) return 0;
  if (purchasePrice > t.secondTierCap) return purchasePrice * t.highValueRate;
  if (purchasePrice > t.firstTierCap) {
    return (
      t.firstTierCap * t.firstTierRate +
      (purchasePrice - t.firstTierCap) * t.secondTierRate
    );
  }
  return purchasePrice * t.firstTierRate;
}

/** Insurance premium in dollars, or 0 when the down payment is 20% or more. */
export function mortgageInsurancePremium(
  baseLoanAmount: number,
  purchasePrice: number,
): number {
  if (purchasePrice <= 0 || baseLoanAmount <= 0) return 0;
  const loanToValue = baseLoanAmount / purchasePrice;
  if (loanToValue <= 0.8) return 0;
  // Insurance is unavailable above $1.5M; the caller surfaces that as a warning.
  const band = [...MORTGAGE_INSURANCE_RATES]
    .sort((a, b) => a.maxLoanToValue - b.maxLoanToValue)
    .find((tier) => loanToValue <= tier.maxLoanToValue);
  const rate = band?.rate ?? MORTGAGE_INSURANCE_RATES[0].rate;
  return Math.round(baseLoanAmount * rate);
}

/**
 * Convert a nominal annual rate compounded semi-annually into the equivalent
 * monthly rate. This is the step most mortgage calculators get wrong.
 */
export function effectiveMonthlyRate(annualRatePercent: number): number {
  const annual = annualRatePercent / 100;
  if (annual === 0) return 0;
  return Math.pow(1 + annual / 2, 1 / 6) - 1;
}

/** Standard amortising payment: `P · i / (1 − (1 + i)^−n)`. */
export function amortisedPayment(
  principal: number,
  monthlyRate: number,
  months: number,
): number {
  if (principal <= 0 || months <= 0) return 0;
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

export function calculateMortgage(input: MortgageInput): MortgageResult {
  const purchasePrice = Math.max(0, input.purchasePrice);
  const downPayment = Math.min(Math.max(0, input.downPayment), purchasePrice);
  const amortizationYears = Math.max(1, input.amortizationYears);

  const baseLoanAmount = purchasePrice - downPayment;
  const downPaymentPercent = purchasePrice > 0 ? (downPayment / purchasePrice) * 100 : 0;

  const warnings: string[] = [];
  const minimum = minimumDownPayment(purchasePrice);
  if (purchasePrice > 0 && downPayment < minimum) {
    warnings.push(
      `The minimum down payment for this price is ${Math.round(minimum).toLocaleString("en-CA")} dollars (${((minimum / purchasePrice) * 100).toFixed(1)}%).`,
    );
  }

  const insurable =
    purchasePrice <= DOWN_PAYMENT_TIERS.secondTierCap && downPaymentPercent < 20;
  if (downPaymentPercent < 20 && purchasePrice > DOWN_PAYMENT_TIERS.secondTierCap) {
    warnings.push(
      "Mortgage default insurance is not available above $1.5M, so a 20% down payment is required at this price.",
    );
  }

  const insurancePremium = insurable
    ? mortgageInsurancePremium(baseLoanAmount, purchasePrice)
    : 0;
  if (insurancePremium > 0) {
    warnings.push(
      "A down payment under 20% requires mortgage default insurance. The premium is added to the amount borrowed.",
    );
  }

  if (downPaymentPercent < 20 && amortizationYears > 25) {
    warnings.push(
      "Insured mortgages are generally limited to a 25-year amortization, with an exception for first-time buyers of new builds.",
    );
  }

  const totalLoanAmount = baseLoanAmount + insurancePremium;
  const monthlyRate = effectiveMonthlyRate(input.interestRate);
  const months = amortizationYears * 12;
  const monthlyPayment = amortisedPayment(totalLoanAmount, monthlyRate, months);
  const totalPaid = monthlyPayment * months;

  return {
    purchasePrice,
    downPayment,
    downPaymentPercent: Math.round(downPaymentPercent * 10) / 10,
    baseLoanAmount,
    insurancePremium,
    totalLoanAmount,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    effectiveMonthlyRate: monthlyRate,
    totalInterestOverTerm: Math.round((totalPaid - totalLoanAmount) * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    warnings,
  };
}

export interface HousingCostInput extends MortgageInput {
  /** Annual municipal and school property taxes, in dollars. */
  annualPropertyTaxes: number;
  /** Monthly condominium fees, in dollars. Zero for a house or plex. */
  monthlyCondoFees: number;
  /** Annual home insurance premium, in dollars. */
  annualInsurance: number;
  /** Estimated monthly heating and utilities, in dollars. */
  monthlyUtilities: number;
}

export interface HousingCostResult {
  mortgage: MortgageResult;
  monthlyMortgage: number;
  monthlyPropertyTaxes: number;
  monthlyCondoFees: number;
  monthlyInsurance: number;
  monthlyUtilities: number;
  /** Everything above, added together. */
  totalMonthlyCost: number;
  /**
   * Payment plus taxes, half of condo fees and a heating allowance — the ratio
   * lenders use for qualification. Returned so the UI can show the income a
   * lender would typically want to see, without pretending to pre-approve anyone.
   */
  qualifyingMonthlyCost: number;
}

/** Total monthly carrying cost, broken out so the UI can show the composition. */
export function calculateHousingCost(input: HousingCostInput): HousingCostResult {
  const mortgage = calculateMortgage(input);
  const monthlyPropertyTaxes = Math.max(0, input.annualPropertyTaxes) / 12;
  const monthlyInsurance = Math.max(0, input.annualInsurance) / 12;
  const monthlyCondoFees = Math.max(0, input.monthlyCondoFees);
  const monthlyUtilities = Math.max(0, input.monthlyUtilities);

  const totalMonthlyCost =
    mortgage.monthlyPayment +
    monthlyPropertyTaxes +
    monthlyInsurance +
    monthlyCondoFees +
    monthlyUtilities;

  // Lenders count only half of condo fees toward the gross debt service ratio.
  const qualifyingMonthlyCost =
    mortgage.monthlyPayment +
    monthlyPropertyTaxes +
    monthlyCondoFees * 0.5 +
    monthlyUtilities;

  return {
    mortgage,
    monthlyMortgage: round2(mortgage.monthlyPayment),
    monthlyPropertyTaxes: round2(monthlyPropertyTaxes),
    monthlyCondoFees: round2(monthlyCondoFees),
    monthlyInsurance: round2(monthlyInsurance),
    monthlyUtilities: round2(monthlyUtilities),
    totalMonthlyCost: round2(totalMonthlyCost),
    qualifyingMonthlyCost: round2(qualifyingMonthlyCost),
  };
}

/**
 * The annual gross income at which this carrying cost hits a given gross debt
 * service ratio. Lenders conventionally cap GDS around 39%.
 */
export function incomeForGrossDebtServiceRatio(
  qualifyingMonthlyCost: number,
  ratio = 0.39,
): number {
  if (ratio <= 0) return 0;
  return Math.round((qualifyingMonthlyCost * 12) / ratio);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

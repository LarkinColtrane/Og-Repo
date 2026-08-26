import { calculateMortgage, type MortgageResult } from "./mortgage";

/**
 * Rental property analysis.
 *
 * The structure here matters as much as the arithmetic: **inputs the user supplies**
 * and **assumptions the model makes** are kept apart, and every assumption is an
 * explicit, overridable field rather than a constant buried in a formula. A cap
 * rate is only as good as the vacancy and management allowances behind it, so the
 * result carries those allowances back out to the UI.
 *
 * Convention followed throughout: net operating income excludes financing. Cap
 * rate is therefore a property-level return, comparable between deals regardless
 * of how each one is financed; cash-on-cash is the financed return.
 */

export interface InvestmentInput {
  purchasePrice: number;
  /** Gross monthly rent from all units, at full occupancy. */
  monthlyRent: number;
  annualPropertyTaxes: number;
  /** Monthly condominium fees. Zero for a plex. */
  monthlyCondoFees: number;
  annualInsurance: number;
  /** Annual maintenance and repairs, in dollars. */
  annualMaintenance: number;
  /**
   * Anything not covered by the named categories — snow removal, a caretaker,
   * accounting, utilities the landlord pays. Annual dollars.
   */
  annualOtherExpenses?: number;
  downPayment: number;
  interestRate: number;
  amortizationYears: number;
  /** Assumption: share of gross rent lost to vacancy and non-payment, percent. */
  vacancyAllowancePercent: number;
  /** Assumption: property management fee as a share of collected rent, percent. */
  managementFeePercent: number;
  /** One-time acquisition costs (transfer duty, notary, inspection) in dollars. */
  closingCosts: number;
  /**
   * A pre-computed loan, when one module has already decided it.
   *
   * The financing comparison owns eligibility, insurance and the borrower
   * profile — rules this module knows nothing about. Passing its result in means
   * the loan is decided once. Two modules independently working out whether a
   * premium applies is exactly how they end up disagreeing by a few dollars and
   * nobody can tell which is right.
   *
   * Omit it and the loan is computed here from `downPayment`, `interestRate` and
   * `amortizationYears`, as before.
   */
  financing?: MortgageResult;
}

export interface InvestmentResult {
  /** Rent at 100% occupancy — before any vacancy allowance. */
  grossAnnualRent: number;
  /** Gross annual rent ÷ purchase price, as a percentage. */
  grossRentalYield: number;
  /** Gross rent less the vacancy allowance. */
  effectiveGrossIncome: number;
  expenses: OperatingExpenses;
  totalAnnualExpenses: number;
  /** Effective gross income less operating expenses. Excludes mortgage payments. */
  netOperatingIncome: number;
  /** NOI ÷ purchase price, as a percentage. */
  capRate: number;
  /** Operating expenses ÷ effective gross income — a sanity check on the inputs. */
  operatingExpenseRatio: number;

  mortgage: MortgageResult;
  monthlyMortgagePayment: number;
  annualDebtService: number;

  monthlyCashFlow: number;
  annualCashFlow: number;
  /** Annual cash flow ÷ total cash invested, as a percentage. */
  cashOnCashReturn: number;
  /** Total cash out of pocket: down payment plus closing costs. */
  totalCashInvested: number;
  /** NOI ÷ annual debt service. Lenders generally want 1.2 or better. */
  debtServiceCoverageRatio: number;
  /** Occupancy at which cash flow reaches zero, as a percentage. */
  breakEvenOccupancy: number;

  /** The assumptions used, echoed back so the UI can display them separately. */
  assumptions: {
    vacancyAllowancePercent: number;
    managementFeePercent: number;
    vacancyAllowanceDollars: number;
    managementFeeDollars: number;
  };
}

export interface OperatingExpenses {
  propertyTaxes: number;
  condoFees: number;
  insurance: number;
  maintenance: number;
  management: number;
  other: number;
}

export function calculateInvestment(input: InvestmentInput): InvestmentResult {
  const purchasePrice = Math.max(0, input.purchasePrice);
  const grossAnnualRent = Math.max(0, input.monthlyRent) * 12;

  const vacancyAllowancePercent = clampPercent(input.vacancyAllowancePercent);
  const managementFeePercent = clampPercent(input.managementFeePercent);

  const vacancyAllowanceDollars = grossAnnualRent * (vacancyAllowancePercent / 100);
  const effectiveGrossIncome = grossAnnualRent - vacancyAllowanceDollars;

  // Management is charged on rent actually collected, not on rent in theory.
  const managementFeeDollars = effectiveGrossIncome * (managementFeePercent / 100);

  const expenses: OperatingExpenses = {
    propertyTaxes: Math.max(0, input.annualPropertyTaxes),
    condoFees: Math.max(0, input.monthlyCondoFees) * 12,
    insurance: Math.max(0, input.annualInsurance),
    maintenance: Math.max(0, input.annualMaintenance),
    management: managementFeeDollars,
    other: Math.max(0, input.annualOtherExpenses ?? 0),
  };

  const totalAnnualExpenses =
    expenses.propertyTaxes +
    expenses.condoFees +
    expenses.insurance +
    expenses.maintenance +
    expenses.management +
    expenses.other;

  const netOperatingIncome = effectiveGrossIncome - totalAnnualExpenses;

  const mortgage =
    input.financing ??
    calculateMortgage({
      purchasePrice,
      downPayment: input.downPayment,
      interestRate: input.interestRate,
      amortizationYears: input.amortizationYears,
    });

  const annualDebtService = mortgage.monthlyPayment * 12;
  const annualCashFlow = netOperatingIncome - annualDebtService;
  const totalCashInvested = Math.max(0, input.downPayment) + Math.max(0, input.closingCosts);

  return {
    grossAnnualRent: round2(grossAnnualRent),
    grossRentalYield: percentOf(grossAnnualRent, purchasePrice),
    effectiveGrossIncome: round2(effectiveGrossIncome),
    expenses: {
      propertyTaxes: round2(expenses.propertyTaxes),
      condoFees: round2(expenses.condoFees),
      insurance: round2(expenses.insurance),
      maintenance: round2(expenses.maintenance),
      management: round2(expenses.management),
      other: round2(expenses.other),
    },
    totalAnnualExpenses: round2(totalAnnualExpenses),
    netOperatingIncome: round2(netOperatingIncome),
    capRate: percentOf(netOperatingIncome, purchasePrice),
    operatingExpenseRatio: percentOf(totalAnnualExpenses, effectiveGrossIncome),

    mortgage,
    monthlyMortgagePayment: round2(mortgage.monthlyPayment),
    annualDebtService: round2(annualDebtService),

    monthlyCashFlow: round2(annualCashFlow / 12),
    annualCashFlow: round2(annualCashFlow),
    cashOnCashReturn: percentOf(annualCashFlow, totalCashInvested),
    totalCashInvested: round2(totalCashInvested),
    debtServiceCoverageRatio:
      annualDebtService > 0
        ? Math.round((netOperatingIncome / annualDebtService) * 100) / 100
        : 0,
    breakEvenOccupancy: breakEvenOccupancy(
      grossAnnualRent,
      totalAnnualExpenses - managementFeeDollars,
      managementFeePercent,
      annualDebtService,
    ),

    assumptions: {
      vacancyAllowancePercent,
      managementFeePercent,
      vacancyAllowanceDollars: round2(vacancyAllowanceDollars),
      managementFeeDollars: round2(managementFeeDollars),
    },
  };
}

/**
 * The occupancy rate at which cash flow is exactly zero.
 *
 * Solving `rent·o·(1 − m) = fixed + debt` for `o`, where management scales with
 * collected rent and everything else is fixed.
 */
function breakEvenOccupancy(
  grossAnnualRent: number,
  fixedExpenses: number,
  managementFeePercent: number,
  annualDebtService: number,
): number {
  const netRentPerOccupancyPoint = grossAnnualRent * (1 - managementFeePercent / 100);
  if (netRentPerOccupancyPoint <= 0) return 100;
  const required = ((fixedExpenses + annualDebtService) / netRentPerOccupancyPoint) * 100;
  return Math.round(Math.min(999, Math.max(0, required)) * 10) / 10;
}

/**
 * Default assumptions, kept here rather than inline in the form so a reader can
 * see every judgement call in one place. They are starting points to argue with,
 * not recommendations.
 */
export const DEFAULT_INVESTMENT_ASSUMPTIONS = {
  vacancyAllowancePercent: 3,
  managementFeePercent: 0,
  /**
   * Maintenance as a share of purchase price per year. The familiar "1% of value"
   * rule of thumb badly overstates this in a high-price market — it is a proxy for
   * *building* cost, and a large share of a Montréal price is land.
   */
  maintenanceRateOfPrice: 0.005,
  /**
   * Property taxes as a share of purchase price per year. Montréal's residential
   * rate is applied to the municipal assessment, which generally sits below market
   * price, so the effective rate against price lands lower than the headline one.
   */
  propertyTaxRateOfPrice: 0.0062,
  /** Annual landlord insurance as a share of purchase price. */
  insuranceRateOfPrice: 0.0015,
  /** Closing costs as a share of purchase price: transfer duty, notary, inspection. */
  closingCostRateOfPrice: 0.025,
} as const;

/**
 * The annual cost of debt per dollar borrowed — annual payments ÷ loan amount.
 *
 * Comparing it against the cap rate is the single most useful read on a financed
 * deal: when the cap rate is below the mortgage constant, borrowing subtracts from
 * the return rather than adding to it, and no amount of optimism about rent fixes
 * that. This is why a property can be perfectly sound and still not cash-flow.
 */
export function mortgageConstant(result: InvestmentResult): number {
  if (result.mortgage.totalLoanAmount <= 0) return 0;
  return (
    Math.round((result.annualDebtService / result.mortgage.totalLoanAmount) * 1000) / 10
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function percentOf(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

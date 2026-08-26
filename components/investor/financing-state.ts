import type { PropertyType } from "@/types";
import type { MortgageProductType, OccupancyType } from "@/types/mortgage";
import type { InvestorAnalysisInput } from "@/lib/calculations/investor-analysis";
import { defaultExpensesFor } from "@/lib/calculations/investor-analysis";
import { DEFAULT_INVESTMENT_ASSUMPTIONS } from "@/lib/calculations/investment";

/**
 * The shape of the investor form.
 *
 * Only state and defaults live here — no arithmetic. Every number the page shows
 * is produced by `lib/calculations/`, so the same figures are reachable from an
 * API route, a script or a test without rendering anything.
 */
export interface FinancingFormState {
  purchasePrice: number;
  propertyType: PropertyType;
  occupancy: OccupancyType;
  units: number;
  monthlyRent: number;

  /** The active down-payment level. Presets write here; so does the custom field. */
  downPaymentPercent: number;
  productType: MortgageProductType;
  termYears: number;
  amortizationYears: number;

  municipalTaxes: number;
  schoolTaxes: number;
  annualInsurance: number;
  annualMaintenance: number;
  monthlyCondoFees: number;
  otherMonthlyExpenses: number;

  vacancyAllowancePercent: number;
  managementFeePercent: number;
  closingCosts: number;
}

export interface FormSeed {
  purchasePrice: number;
  monthlyRent: number;
  propertyType: PropertyType;
  units: number;
}

/**
 * Build the opening form state for a property.
 *
 * The occupancy default is `investment`, which is the stricter case: it starts
 * the reader at a 20% floor and makes the eligibility rules visible immediately
 * rather than only when they switch. Someone buying a plex to live in can flip
 * it, and the 5% and 10% levels appear.
 */
export function createFormState(seed: FormSeed): FinancingFormState {
  const expenses = defaultExpensesFor(seed.purchasePrice, seed.propertyType);

  return {
    purchasePrice: Math.round(seed.purchasePrice / 1000) * 1000,
    propertyType: seed.propertyType,
    occupancy: "investment",
    units: Math.max(1, seed.units),
    monthlyRent: Math.round(seed.monthlyRent / 5) * 5,

    downPaymentPercent: 20,
    productType: "fixed",
    termYears: 5,
    amortizationYears: 25,

    municipalTaxes: expenses.municipalTaxes,
    schoolTaxes: expenses.schoolTaxes,
    annualInsurance: expenses.annualInsurance,
    annualMaintenance: expenses.annualMaintenance,
    monthlyCondoFees: expenses.monthlyCondoFees,
    otherMonthlyExpenses: 0,

    vacancyAllowancePercent: DEFAULT_INVESTMENT_ASSUMPTIONS.vacancyAllowancePercent,
    managementFeePercent: DEFAULT_INVESTMENT_ASSUMPTIONS.managementFeePercent,
    closingCosts: expenses.closingCosts,
  };
}

/** Map form state onto the calculation input, adding the rate under comparison. */
export function toAnalysisInput(
  state: FinancingFormState,
  interestRate: number,
): InvestorAnalysisInput {
  return {
    purchasePrice: state.purchasePrice,
    propertyType: state.propertyType,
    occupancy: state.occupancy,
    units: state.units,
    monthlyRent: state.monthlyRent,
    downPaymentPercent: state.downPaymentPercent,
    interestRate,
    termYears: state.termYears,
    amortizationYears: state.amortizationYears,
    municipalTaxes: state.municipalTaxes,
    schoolTaxes: state.schoolTaxes,
    annualInsurance: state.annualInsurance,
    annualMaintenance: state.annualMaintenance,
    monthlyCondoFees: state.monthlyCondoFees,
    otherMonthlyExpenses: state.otherMonthlyExpenses,
    vacancyAllowancePercent: state.vacancyAllowancePercent,
    managementFeePercent: state.managementFeePercent,
    closingCosts: state.closingCosts,
  };
}

/** The preset down-payment levels the comparison always evaluates. */
export const DOWN_PAYMENT_PRESETS = [5, 10, 20] as const;

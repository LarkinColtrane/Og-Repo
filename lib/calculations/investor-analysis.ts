import type { PropertyType } from "@/types";
import type { OccupancyType } from "@/types/mortgage";
import {
  calculateFinancingScenario,
  type FinancingScenario,
} from "./financing";
import { effectiveMonthlyRate, type MortgageResult } from "./mortgage";
import {
  calculateInvestment,
  mortgageConstant,
  type InvestmentResult,
} from "./investment";
import { estimateClosingCosts } from "./transfer-tax";

/**
 * The bridge between financing and investment analysis.
 *
 * Both halves already existed; what this module adds is the guarantee that they
 * describe the *same loan*. The financing layer owns eligibility, insurance and
 * the borrower profile — rules the investment model knows nothing about — so it
 * decides the loan and hands the result to the investment math rather than each
 * working it out separately.
 *
 * Everything here is a pure function. The API route and the browser both call it,
 * which is why a server-rendered comparison and a client-rendered one cannot
 * disagree.
 */

export interface InvestorAnalysisInput {
  purchasePrice: number;
  propertyType: PropertyType;
  occupancy: OccupancyType;
  units: number;
  /** Gross monthly rent from all units at full occupancy. */
  monthlyRent: number;

  downPaymentPercent: number;
  interestRate: number;
  termYears: number;
  amortizationYears: number;

  /** Québec bills municipal and school taxes separately. Both annual. */
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

export interface InvestorAnalysis {
  financing: FinancingScenario;
  investment: InvestmentResult;
  /** Annual debt service ÷ amount borrowed. Compare against the cap rate. */
  mortgageConstant: number;
  /** Down payment plus closing costs — what has to be in the bank at closing. */
  totalCashRequired: number;
}

/**
 * Reshape a financing scenario into the `MortgageResult` the investment model
 * expects, so the loan travels between the two modules intact.
 */
export function toMortgageResult(scenario: FinancingScenario): MortgageResult {
  const months = Math.max(1, Math.round(scenario.input.amortizationYears * 12));
  const totalPaid = scenario.payments.monthly * months;

  return {
    purchasePrice: scenario.input.purchasePrice,
    downPayment: scenario.downPayment,
    downPaymentPercent: scenario.input.downPaymentPercent,
    baseLoanAmount: scenario.baseMortgage,
    insurancePremium: scenario.insurancePremium,
    totalLoanAmount: scenario.financedMortgage,
    monthlyPayment: scenario.payments.monthly,
    effectiveMonthlyRate: effectiveMonthlyRate(scenario.input.interestRate),
    totalInterestOverTerm: Math.round((totalPaid - scenario.financedMortgage) * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    // Eligibility findings are richer than the plain-string warnings this shape
    // carries, so the blocking ones are mapped across and the UI reads the
    // structured version from `financing.eligibility`.
    warnings: [
      ...scenario.eligibility.blockers.map((finding) => finding.message),
      ...scenario.eligibility.notices.map((finding) => finding.message),
    ],
  };
}

export function analyseInvestment(input: InvestorAnalysisInput): InvestorAnalysis {
  const financing = calculateFinancingScenario({
    purchasePrice: input.purchasePrice,
    downPaymentPercent: input.downPaymentPercent,
    interestRate: input.interestRate,
    amortizationYears: input.amortizationYears,
    termYears: input.termYears,
    occupancy: input.occupancy,
    units: input.units,
  });

  const investment = calculateInvestment({
    purchasePrice: input.purchasePrice,
    monthlyRent: input.monthlyRent,
    // The two Québec tax bills are separate inputs but one operating expense.
    annualPropertyTaxes: Math.max(0, input.municipalTaxes) + Math.max(0, input.schoolTaxes),
    monthlyCondoFees: input.monthlyCondoFees,
    annualInsurance: input.annualInsurance,
    annualMaintenance: input.annualMaintenance,
    annualOtherExpenses: Math.max(0, input.otherMonthlyExpenses) * 12,
    downPayment: financing.downPayment,
    interestRate: input.interestRate,
    amortizationYears: input.amortizationYears,
    vacancyAllowancePercent: input.vacancyAllowancePercent,
    managementFeePercent: input.managementFeePercent,
    closingCosts: input.closingCosts,
    // The loan the financing layer decided — insurance included or excluded
    // according to the eligibility rules, not recomputed here.
    financing: toMortgageResult(financing),
  });

  return {
    financing,
    investment,
    mortgageConstant: mortgageConstant(investment),
    totalCashRequired:
      Math.round((financing.downPayment + Math.max(0, input.closingCosts)) * 100) / 100,
  };
}

/**
 * Sensible starting values for a property, derived from its price.
 *
 * Every one of these is an assumption the reader should argue with — they are
 * here so the form opens with something coherent rather than zeros, not because
 * they are right for any particular building.
 */
export function defaultExpensesFor(
  purchasePrice: number,
  propertyType: PropertyType,
): {
  municipalTaxes: number;
  schoolTaxes: number;
  annualInsurance: number;
  annualMaintenance: number;
  monthlyCondoFees: number;
  closingCosts: number;
} {
  const price = Math.max(0, purchasePrice);

  return {
    // Montréal splits the tax bill: the municipal share is by far the larger,
    // and the school levy is a small provincial rate on the same assessment.
    municipalTaxes: roundTo(price * 0.0055, 100),
    schoolTaxes: roundTo(price * 0.0007, 50),
    annualInsurance: roundTo(price * 0.0015, 50),
    annualMaintenance: roundTo(price * 0.005, 100),
    monthlyCondoFees: propertyType === "condo" ? 350 : 0,
    closingCosts: estimateClosingCosts(price).total,
  };
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

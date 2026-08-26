import type {
  BorrowerProfile,
  Lender,
  MortgageRate,
  OccupancyType,
} from "@/types/mortgage";
import {
  amortisedPayment,
  DOWN_PAYMENT_TIERS,
  effectiveMonthlyRate,
  minimumDownPayment,
  mortgageInsurancePremium,
} from "./mortgage";

/**
 * Financing comparison: down-payment scenarios, payment frequencies, term
 * amortization, and lender-by-lender results.
 *
 * Everything here is real arithmetic. The *rates* fed into it are demonstration
 * data, and the UI says so on every figure — but the payment produced from a
 * given rate is the payment, and the eligibility rules are the actual Canadian
 * ones rather than a simplification.
 *
 * The whole module is pure functions over plain objects. No React, no fetching:
 * the API route and the browser both call the same functions, which is what keeps
 * a server-computed comparison and a client-computed one from ever disagreeing.
 */

/**
 * Eligibility rules, dated because they change.
 *
 * Sources are federal policy (Department of Finance / OSFI) and CMHC's published
 * product criteria. Re-check before relying on any of it — the constant is
 * exported so the UI can show the reader how stale it might be.
 */
export const FINANCING_RULES_LAST_REVIEWED = "2026-01";

/**
 * Minimum down payment by unit count and occupancy, as a fraction.
 *
 * These are the rules that make "5%, 10%, 20%" not universally available:
 *
 *  - **Owner-occupied, 1–2 units** — 5%, subject to the price tiers below.
 *  - **Owner-occupied, 3–4 units** — 10%. A triplex you live in is still an
 *    insurable home; a triplex you do not live in is not.
 *  - **Not owner-occupied (pure rental)** — 20%. Default insurance is generally
 *    unavailable on a small rental the borrower will not occupy, which is the
 *    single most consequential rule on this page: it removes the 5% and 10%
 *    columns entirely for an investment purchase.
 */
export const MINIMUM_DOWN_PAYMENT_RULES = {
  ownerOccupiedSmall: 0.05,
  ownerOccupiedLarge: 0.1,
  investment: 0.2,
  /** Above this unit count the property is commercial and out of scope here. */
  maxResidentialUnits: 4,
} as const;

/** Insured mortgages are capped at this amortization. */
export const INSURED_MAX_AMORTIZATION_YEARS = 25;

export interface FinancingScenarioInput {
  purchasePrice: number;
  /** Down payment as a percentage of price. */
  downPaymentPercent: number;
  /** Nominal annual rate, e.g. 4.79. */
  interestRate: number;
  /** Amortization in years. */
  amortizationYears: number;
  /** Term in years — how long the rate is held. */
  termYears: number;
  occupancy: OccupancyType;
  /** Residential units in the building. 1 for a condo or single-family house. */
  units: number;
}

/** Why a scenario cannot be financed, in the reader's language. */
export interface EligibilityFinding {
  /** Machine-readable so the UI can style or group them. */
  code:
    | "below-minimum-down-payment"
    | "insurance-unavailable-high-value"
    | "insurance-unavailable-rental"
    | "insured-amortization-cap"
    | "too-many-units";
  message: string;
}

export interface EligibilityAssessment {
  eligible: boolean;
  /** Blocking problems. Non-empty means `eligible` is false. */
  blockers: EligibilityFinding[];
  /** Things worth knowing that do not block the scenario. */
  notices: EligibilityFinding[];
  /** The lowest down payment this property can be bought with, in dollars. */
  minimumDownPayment: number;
  /** The same, as a percentage of price. */
  minimumDownPaymentPercent: number;
  /** Whether default insurance applies — drives which rate the lender quotes. */
  insured: boolean;
}

/**
 * The minimum down payment for a property, combining the federal price tiers
 * with the occupancy and unit-count rules.
 *
 * The price tiers (5% on the first $500k, 10% to $1.5M, 20% above) only apply to
 * insurable purchases. A rental is uninsurable, so its floor is a flat 20%
 * regardless of price.
 */
export function minimumDownPaymentFor(
  purchasePrice: number,
  occupancy: OccupancyType,
  units: number,
): number {
  const price = Math.max(0, purchasePrice);
  if (price === 0) return 0;

  const rules = MINIMUM_DOWN_PAYMENT_RULES;

  if (occupancy === "investment") return price * rules.investment;
  if (units > rules.maxResidentialUnits) return price * rules.investment;

  // Owner-occupied 3–4 units: 10% floor, but the price tiers can push it higher.
  const tierMinimum = minimumDownPayment(price);
  if (units >= 3) return Math.max(tierMinimum, price * rules.ownerOccupiedLarge);

  return tierMinimum;
}

/**
 * Assess one down-payment scenario against the Canadian rules.
 *
 * Returns findings rather than throwing, because "not eligible" is a result the
 * UI has to *show* — an unavailable 5% column that explains itself teaches more
 * than one that silently disappears.
 */
export function assessEligibility(input: FinancingScenarioInput): EligibilityAssessment {
  const price = Math.max(0, input.purchasePrice);
  const downPayment = (price * clampPercent(input.downPaymentPercent)) / 100;
  const minimum = minimumDownPaymentFor(price, input.occupancy, input.units);
  const minimumPercent = price > 0 ? (minimum / price) * 100 : 0;

  const blockers: EligibilityFinding[] = [];
  const notices: EligibilityFinding[] = [];

  const wantsInsurance = price > 0 && downPayment < price * 0.2;

  if (input.units > MINIMUM_DOWN_PAYMENT_RULES.maxResidentialUnits) {
    blockers.push({
      code: "too-many-units",
      message: `Buildings over ${MINIMUM_DOWN_PAYMENT_RULES.maxResidentialUnits} units are financed as commercial property, which this tool does not model.`,
    });
  }

  if (wantsInsurance && input.occupancy === "investment") {
    blockers.push({
      code: "insurance-unavailable-rental",
      message:
        "Default insurance is generally unavailable on a property the borrower will not occupy, so an investment purchase needs at least 20% down.",
    });
  }

  if (wantsInsurance && price > DOWN_PAYMENT_TIERS.secondTierCap) {
    blockers.push({
      code: "insurance-unavailable-high-value",
      message: `Default insurance is not available above ${formatMoney(DOWN_PAYMENT_TIERS.secondTierCap)}, so a purchase at this price requires 20% down.`,
    });
  }

  // Only report "below the minimum" when it is not already explained by one of
  // the rules above — repeating the same problem in three sentences is noise.
  if (downPayment < minimum - 0.5 && blockers.length === 0) {
    blockers.push({
      code: "below-minimum-down-payment",
      message: `The minimum down payment here is ${formatMoney(minimum)} (${minimumPercent.toFixed(1)}%).`,
    });
  }

  const insured = wantsInsurance && blockers.length === 0;

  if (insured && input.amortizationYears > INSURED_MAX_AMORTIZATION_YEARS) {
    blockers.push({
      code: "insured-amortization-cap",
      message: `Insured mortgages are limited to a ${INSURED_MAX_AMORTIZATION_YEARS}-year amortization. Reduce the amortization or put 20% down.`,
    });
  }

  if (insured && blockers.length === 0) {
    notices.push({
      code: "insurance-unavailable-high-value",
      message:
        "This scenario requires mortgage default insurance. The premium is added to the amount borrowed rather than paid at closing.",
    });
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    notices,
    minimumDownPayment: Math.round(minimum),
    minimumDownPaymentPercent: Math.round(minimumPercent * 10) / 10,
    insured: insured && blockers.length === 0,
  };
}

/** Which rate a lender would quote for this scenario. */
export function borrowerProfileFor(assessment: EligibilityAssessment): BorrowerProfile {
  return assessment.insured ? "insured" : "uninsured";
}

/**
 * What happens over the **term** — not the amortization.
 *
 * A Canadian mortgage is amortized over 25 years but contracted for 5. At the end
 * of the term the balance is due and has to be renewed at whatever rate exists
 * then. This function answers the question that actually matters when comparing
 * lenders: over the years you are committed to this rate, how much of the
 * payment went to principal, how much to interest, and what is left owing?
 *
 * Computed by walking the schedule month by month rather than with a closed-form
 * shortcut — a hundred iterations is nothing, and the loop is legible enough that
 * a reader can check it against a statement.
 */
export interface TermAmortization {
  termMonths: number;
  principalPaid: number;
  interestPaid: number;
  balanceAtEndOfTerm: number;
  totalPaidOverTerm: number;
}

export function amortiseOverTerm(
  principal: number,
  annualRatePercent: number,
  amortizationYears: number,
  termYears: number,
): TermAmortization {
  const monthlyRate = effectiveMonthlyRate(annualRatePercent);
  const amortizationMonths = Math.max(1, Math.round(amortizationYears * 12));
  const termMonths = Math.min(
    Math.max(1, Math.round(termYears * 12)),
    amortizationMonths,
  );
  const payment = amortisedPayment(principal, monthlyRate, amortizationMonths);

  let balance = principal;
  let interestPaid = 0;

  for (let month = 0; month < termMonths; month += 1) {
    const interest = balance * monthlyRate;
    const principalPortion = Math.min(payment - interest, balance);
    interestPaid += interest;
    balance -= principalPortion;
    if (balance <= 0) {
      balance = 0;
      break;
    }
  }

  return {
    termMonths,
    principalPaid: round2(principal - balance),
    interestPaid: round2(interestPaid),
    balanceAtEndOfTerm: round2(balance),
    totalPaidOverTerm: round2(principal - balance + interestPaid),
  };
}

/**
 * The three payment frequencies Canadian lenders offer.
 *
 * The distinction that matters: **accelerated** bi-weekly is half the monthly
 * payment made 26 times a year, which is thirteen monthly payments rather than
 * twelve. The extra payment goes entirely to principal, which is why it shortens
 * the amortization. Plain bi-weekly is the monthly amount spread over 26 — the
 * same money, just timed to a pay cheque.
 */
export interface PaymentSchedule {
  monthly: number;
  biWeekly: number;
  acceleratedBiWeekly: number;
  /** Extra principal paid per year by choosing accelerated over plain bi-weekly. */
  acceleratedAnnualExtra: number;
}

export function paymentSchedule(monthlyPayment: number): PaymentSchedule {
  const biWeekly = (monthlyPayment * 12) / 26;
  const acceleratedBiWeekly = monthlyPayment / 2;
  return {
    monthly: round2(monthlyPayment),
    biWeekly: round2(biWeekly),
    acceleratedBiWeekly: round2(acceleratedBiWeekly),
    acceleratedAnnualExtra: round2(acceleratedBiWeekly * 26 - monthlyPayment * 12),
  };
}

/** Everything a single financing scenario produces. */
export interface FinancingScenario {
  input: FinancingScenarioInput;
  eligibility: EligibilityAssessment;
  borrowerProfile: BorrowerProfile;

  downPayment: number;
  /** Price less down payment, before insurance. */
  baseMortgage: number;
  insurancePremium: number;
  /** What is actually borrowed. */
  financedMortgage: number;
  loanToValue: number;

  payments: PaymentSchedule;
  term: TermAmortization;

  /** Annual payments ÷ amount borrowed. Compare against the cap rate. */
  mortgageConstant: number;
}

/**
 * Compute one financing scenario. Returns a result even when the scenario is
 * ineligible — the figures are then hypothetical, and the caller is expected to
 * check `eligibility.eligible` before presenting them as available.
 */
export function calculateFinancingScenario(
  input: FinancingScenarioInput,
): FinancingScenario {
  const price = Math.max(0, input.purchasePrice);
  const eligibility = assessEligibility(input);
  const downPayment = Math.min((price * clampPercent(input.downPaymentPercent)) / 100, price);
  const baseMortgage = price - downPayment;

  // Insurance applies only when the scenario is actually insurable. A 20%-down
  // scenario must never pick up a premium, and neither must an ineligible one.
  const insurancePremium = eligibility.insured
    ? mortgageInsurancePremium(baseMortgage, price)
    : 0;

  const financedMortgage = baseMortgage + insurancePremium;
  const monthlyRate = effectiveMonthlyRate(input.interestRate);
  const monthlyPayment = amortisedPayment(
    financedMortgage,
    monthlyRate,
    Math.max(1, Math.round(input.amortizationYears * 12)),
  );

  return {
    input,
    eligibility,
    borrowerProfile: borrowerProfileFor(eligibility),
    downPayment: round2(downPayment),
    baseMortgage: round2(baseMortgage),
    insurancePremium: round2(insurancePremium),
    financedMortgage: round2(financedMortgage),
    loanToValue: price > 0 ? Math.round((financedMortgage / price) * 1000) / 10 : 0,
    payments: paymentSchedule(monthlyPayment),
    term: amortiseOverTerm(
      financedMortgage,
      input.interestRate,
      input.amortizationYears,
      input.termYears,
    ),
    mortgageConstant:
      financedMortgage > 0
        ? Math.round(((monthlyPayment * 12) / financedMortgage) * 1000) / 10
        : 0,
  };
}

/** One lender's result for a scenario. */
export interface LenderFinancing {
  lender: Lender;
  rate: MortgageRate;
  scenario: FinancingScenario;
  /** True for the lowest monthly payment among eligible lenders. */
  isLowestPayment: boolean;
  /** True for the lowest quoted rate among eligible lenders. */
  isLowestRate: boolean;
}

export interface LenderComparison {
  /** The scenario every lender was priced against, using the median rate. */
  reference: FinancingScenario;
  lenders: LenderFinancing[];
  /** Present only when at least one lender could be priced. */
  lowestPaymentLenderId: string | null;
  lowestRateLenderId: string | null;
  /** Monthly-payment spread between the cheapest and dearest lender shown. */
  paymentSpread: number;
}

/**
 * Price a scenario at every lender.
 *
 * "Lowest" is computed, not editorialised. The caller must present it as the
 * lowest figure *under these assumptions* — a payment comparison says nothing
 * about approval odds, prepayment terms, penalty formulas, or whether a lender
 * will lend on this property at all, and those routinely matter more than a few
 * basis points.
 */
export function compareLenders(options: {
  input: Omit<FinancingScenarioInput, "interestRate">;
  lenders: Lender[];
  rates: MortgageRate[];
}): LenderComparison {
  const { input, lenders, rates } = options;

  // Eligibility does not depend on the rate, so it is settled once — and the
  // borrower profile it produces decides which rate each lender quotes.
  const probe = assessEligibility({ ...input, interestRate: 0 });
  const profile = borrowerProfileFor(probe);

  const rows: LenderFinancing[] = [];

  // `rates` is already narrowed to one product and term by the caller, so the
  // only remaining dimension is the borrower profile the scenario implies.
  const matched = lenders
    .map((lender) => {
      const rate = rates.find(
        (entry) =>
          entry.lenderId === lender.id && entry.borrowerProfile === profile,
      );
      return rate ? { lender, rate } : null;
    })
    .filter((entry): entry is { lender: Lender; rate: MortgageRate } => entry !== null);

  for (const { lender, rate } of matched) {
    rows.push({
      lender,
      rate,
      scenario: calculateFinancingScenario({ ...input, interestRate: rate.rate }),
      isLowestPayment: false,
      isLowestRate: false,
    });
  }

  const eligible = rows.filter((row) => row.scenario.eligibility.eligible);

  let lowestPaymentLenderId: string | null = null;
  let lowestRateLenderId: string | null = null;
  let paymentSpread = 0;

  if (eligible.length > 0) {
    const cheapest = eligible.reduce((best, row) =>
      row.scenario.payments.monthly < best.scenario.payments.monthly ? row : best,
    );
    const dearest = eligible.reduce((worst, row) =>
      row.scenario.payments.monthly > worst.scenario.payments.monthly ? row : worst,
    );
    const sharpest = eligible.reduce((best, row) =>
      row.rate.rate < best.rate.rate ? row : best,
    );

    lowestPaymentLenderId = cheapest.lender.id;
    lowestRateLenderId = sharpest.lender.id;
    paymentSpread = round2(
      dearest.scenario.payments.monthly - cheapest.scenario.payments.monthly,
    );

    for (const row of rows) {
      row.isLowestPayment = row.lender.id === cheapest.lender.id;
      row.isLowestRate = row.lender.id === sharpest.lender.id;
    }
  }

  const medianRate = medianOf(matched.map((entry) => entry.rate.rate));

  return {
    reference: calculateFinancingScenario({ ...input, interestRate: medianRate }),
    lenders: rows,
    lowestPaymentLenderId,
    lowestRateLenderId,
    paymentSpread,
  };
}

/** One cell of the lender × down-payment matrix. */
export interface MatrixCell {
  downPaymentPercent: number;
  eligible: boolean;
  /** Null when the scenario is not available at this down payment. */
  monthlyPayment: number | null;
  /** The first blocking reason, for the cell's tooltip. */
  reason: string | null;
  rate: number | null;
}

export interface MatrixRow {
  lender: Lender;
  cells: MatrixCell[];
}

export interface FinancingMatrix {
  downPaymentPercents: number[];
  rows: MatrixRow[];
  /** Down-payment levels that are unavailable for every lender, with the reason. */
  unavailableLevels: Array<{ downPaymentPercent: number; reason: string }>;
}

/**
 * Build the lender × down-payment grid.
 *
 * Eligibility is a property of the *property and buyer*, not of the lender, so a
 * blocked column is blocked for everyone. The matrix still renders the column —
 * showing "Not eligible" with a reason is the informative outcome; hiding it just
 * raises the question of where 5% went.
 */
export function buildFinancingMatrix(options: {
  input: Omit<FinancingScenarioInput, "interestRate" | "downPaymentPercent">;
  downPaymentPercents: number[];
  lenders: Lender[];
  /** Rates for the chosen product and term, both borrower profiles. */
  rates: MortgageRate[];
}): FinancingMatrix {
  const { input, downPaymentPercents, lenders, rates } = options;

  const rows: MatrixRow[] = lenders.map((lender) => ({
    lender,
    cells: downPaymentPercents.map((downPaymentPercent) => {
      const scenarioInput = { ...input, downPaymentPercent };
      const assessment = assessEligibility({ ...scenarioInput, interestRate: 0 });
      const profile = borrowerProfileFor(assessment);
      const rate = rates.find(
        (entry) => entry.lenderId === lender.id && entry.borrowerProfile === profile,
      );

      if (!assessment.eligible || !rate) {
        return {
          downPaymentPercent,
          eligible: false,
          monthlyPayment: null,
          reason: assessment.blockers[0]?.message ?? "No rate on record for this profile.",
          rate: null,
        };
      }

      const scenario = calculateFinancingScenario({
        ...scenarioInput,
        interestRate: rate.rate,
      });

      return {
        downPaymentPercent,
        eligible: true,
        monthlyPayment: scenario.payments.monthly,
        reason: null,
        rate: rate.rate,
      };
    }),
  }));

  const unavailableLevels = downPaymentPercents
    .map((downPaymentPercent, index) => {
      const blocked = rows.every((row) => !row.cells[index].eligible);
      const reason = rows[0]?.cells[index].reason ?? "";
      return blocked && reason ? { downPaymentPercent, reason } : null;
    })
    .filter((entry): entry is { downPaymentPercent: number; reason: string } => entry !== null);

  return { downPaymentPercents, rows, unavailableLevels };
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-CA")}`;
}

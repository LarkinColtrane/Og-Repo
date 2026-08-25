"use client";

import { useMemo, useState } from "react";
import { copy, interpolate } from "@/lib/i18n";
import {
  calculateInvestment,
  DEFAULT_INVESTMENT_ASSUMPTIONS,
  mortgageConstant,
} from "@/lib/calculations/investment";
import { estimateClosingCosts } from "@/lib/calculations/transfer-tax";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
} from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NumberField, RangeField } from "@/components/ui/number-field";
import { Button } from "@/components/ui/button";
import { ResultGroup, ResultRow } from "./result-row";

/**
 * Form state. Declared explicitly so the default-assumption constants (which are
 * `as const`) widen to `number` rather than pinning each field to its literal.
 */
interface InvestmentFormState {
  purchasePrice: number;
  monthlyRent: number;
  annualPropertyTaxes: number;
  monthlyCondoFees: number;
  annualInsurance: number;
  annualMaintenance: number;
  downPaymentPercent: number;
  interestRate: number;
  amortizationYears: number;
  vacancyAllowancePercent: number;
  managementFeePercent: number;
  closingCosts: number;
}

/**
 * Rental property analysis.
 *
 * The form is split into **inputs** — things about a specific property — and
 * **assumptions** — judgement calls the model makes on the reader's behalf. That
 * division is deliberate and visible: a cap rate is only as trustworthy as the
 * vacancy and management allowances behind it, and burying those in a constant
 * would make the output look more authoritative than it is.
 */
export function InvestmentCalculator({
  defaultPrice,
  defaultMonthlyRent,
  defaultCondoFees = 0,
  neighbourhoodName,
  prefillDetail,
}: {
  defaultPrice: number;
  defaultMonthlyRent: number;
  defaultCondoFees?: number;
  neighbourhoodName?: string;
  /** Extra sentence explaining how the prefilled rent was arrived at. */
  prefillDetail?: string;
}) {
  const initial = useMemo<InvestmentFormState>(() => {
    const price = Math.round(defaultPrice / 1000) * 1000;
    const assumptions = DEFAULT_INVESTMENT_ASSUMPTIONS;
    return {
      purchasePrice: price,
      monthlyRent: Math.round(defaultMonthlyRent / 5) * 5,
      annualPropertyTaxes: Math.round((price * assumptions.propertyTaxRateOfPrice) / 100) * 100,
      monthlyCondoFees: defaultCondoFees,
      annualInsurance: Math.round((price * assumptions.insuranceRateOfPrice) / 50) * 50,
      annualMaintenance: Math.round((price * assumptions.maintenanceRateOfPrice) / 100) * 100,
      downPaymentPercent: 20,
      interestRate: 4.75,
      amortizationYears: 25,
      vacancyAllowancePercent: assumptions.vacancyAllowancePercent,
      managementFeePercent: assumptions.managementFeePercent,
      closingCosts: estimateClosingCosts(price).total,
    };
  }, [defaultPrice, defaultMonthlyRent, defaultCondoFees]);

  const [inputs, setInputs] = useState(initial);
  const set = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) =>
    setInputs((current) => ({ ...current, [key]: value }));

  const downPayment = (inputs.purchasePrice * inputs.downPaymentPercent) / 100;

  const result = calculateInvestment({
    purchasePrice: inputs.purchasePrice,
    monthlyRent: inputs.monthlyRent,
    annualPropertyTaxes: inputs.annualPropertyTaxes,
    monthlyCondoFees: inputs.monthlyCondoFees,
    annualInsurance: inputs.annualInsurance,
    annualMaintenance: inputs.annualMaintenance,
    downPayment,
    interestRate: inputs.interestRate,
    amortizationYears: inputs.amortizationYears,
    vacancyAllowancePercent: inputs.vacancyAllowancePercent,
    managementFeePercent: inputs.managementFeePercent,
    closingCosts: inputs.closingCosts,
  });

  const cashFlowTone = result.monthlyCashFlow >= 0 ? "good" : "critical";
  const constant = mortgageConstant(result);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={copy.investPage.inputsTitle}
          description={
            neighbourhoodName
              ? [
                  interpolate(copy.investPage.prefillNote, {
                    neighbourhood: neighbourhoodName,
                  }),
                  prefillDetail,
                ]
                  .filter(Boolean)
                  .join(" ")
              : prefillDetail
          }
          actions={
            <Button size="sm" variant="ghost" onClick={() => setInputs(initial)}>
              {copy.actions.reset}
            </Button>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField
              label={copy.calculator.purchasePrice}
              value={inputs.purchasePrice}
              onChange={(value) => set("purchasePrice", value)}
              prefix="$"
              step={5000}
            />
            <NumberField
              label={copy.calculator.monthlyRent}
              value={inputs.monthlyRent}
              onChange={(value) => set("monthlyRent", value)}
              prefix="$"
              step={25}
              hint="Total for all units, at full occupancy."
            />
            <NumberField
              label={copy.calculator.propertyTaxes}
              value={inputs.annualPropertyTaxes}
              onChange={(value) => set("annualPropertyTaxes", value)}
              prefix="$"
              step={100}
            />
            <NumberField
              label={copy.calculator.condoFees}
              value={inputs.monthlyCondoFees}
              onChange={(value) => set("monthlyCondoFees", value)}
              prefix="$"
              step={25}
              hint="Zero for a plex."
            />
            <NumberField
              label={copy.calculator.insurance}
              value={inputs.annualInsurance}
              onChange={(value) => set("annualInsurance", value)}
              prefix="$"
              step={50}
            />
            <NumberField
              label={copy.calculator.maintenance}
              value={inputs.annualMaintenance}
              onChange={(value) => set("annualMaintenance", value)}
              prefix="$"
              step={100}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-3">
            <RangeField
              label={`${copy.calculator.downPayment} — ${formatCurrency(downPayment)}`}
              value={inputs.downPaymentPercent}
              onChange={(value) => set("downPaymentPercent", value)}
              min={5}
              max={60}
              step={0.5}
              format={(value) => formatPercent(value)}
            />
            <RangeField
              label={copy.calculator.interestRate}
              value={inputs.interestRate}
              onChange={(value) => set("interestRate", value)}
              min={1}
              max={10}
              step={0.05}
              format={(value) => `${value.toFixed(2)}%`}
            />
            <RangeField
              label={copy.calculator.amortization}
              value={inputs.amortizationYears}
              onChange={(value) => set("amortizationYears", value)}
              min={5}
              max={30}
              step={5}
              format={(value) => `${value} ${copy.calculator.years}`}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={copy.investPage.assumptionsTitle}
          description={copy.investPage.assumptionsNote}
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <RangeField
              label={copy.calculator.vacancyAllowance}
              value={inputs.vacancyAllowancePercent}
              onChange={(value) => set("vacancyAllowancePercent", value)}
              min={0}
              max={15}
              step={0.5}
              format={(value) => formatPercent(value)}
            />
            <RangeField
              label={copy.calculator.managementFee}
              value={inputs.managementFeePercent}
              onChange={(value) => set("managementFeePercent", value)}
              min={0}
              max={12}
              step={0.5}
              format={(value) => formatPercent(value)}
            />
            <NumberField
              label={copy.calculator.closingCosts}
              value={inputs.closingCosts}
              onChange={(value) => set("closingCosts", value)}
              prefix="$"
              step={500}
              hint="Transfer duty, notary, inspection."
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={copy.investPage.resultsTitle} />
        <CardBody>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <ResultGroup title={copy.investPage.incomeTitle}>
              <ResultRow
                label={copy.calculator.grossAnnualRent}
                value={formatCurrency(result.grossAnnualRent)}
                hint="Twelve months of rent at full occupancy, before any allowance."
              />
              <ResultRow
                label={`Vacancy allowance (${formatPercent(result.assumptions.vacancyAllowancePercent)})`}
                value={`−${formatCurrency(result.assumptions.vacancyAllowanceDollars)}`}
              />
              <ResultRow
                label={copy.calculator.effectiveGrossIncome}
                value={formatCurrency(result.effectiveGrossIncome)}
                emphasis
              />
              <ResultRow
                label={copy.calculator.grossYield}
                value={formatPercent(result.grossRentalYield)}
                hint="Gross annual rent divided by purchase price. Ignores every expense, which is why it always flatters a property."
              />
            </ResultGroup>

            <ResultGroup title={copy.investPage.expensesTitle}>
              <ResultRow
                label={copy.calculator.propertyTaxes}
                value={formatCurrency(result.expenses.propertyTaxes)}
              />
              {result.expenses.condoFees > 0 ? (
                <ResultRow
                  label={copy.calculator.condoFees}
                  value={formatCurrency(result.expenses.condoFees)}
                />
              ) : null}
              <ResultRow
                label={copy.calculator.insurance}
                value={formatCurrency(result.expenses.insurance)}
              />
              <ResultRow
                label={copy.calculator.maintenance}
                value={formatCurrency(result.expenses.maintenance)}
              />
              {result.expenses.management > 0 ? (
                <ResultRow
                  label={copy.calculator.managementFee}
                  value={formatCurrency(result.expenses.management)}
                />
              ) : null}
              <ResultRow
                label={copy.calculator.totalExpenses}
                value={formatCurrency(result.totalAnnualExpenses)}
                emphasis
              />
              <ResultRow
                label="Operating expense ratio"
                value={formatPercent(result.operatingExpenseRatio)}
                hint="Operating expenses as a share of collected rent. Much below 30% usually means something has been left out."
              />
            </ResultGroup>

            <ResultGroup title={copy.investPage.returnsTitle}>
              <ResultRow
                label={copy.calculator.netOperatingIncome}
                value={formatCurrency(result.netOperatingIncome)}
                hint="Income after operating expenses but before financing — which is what makes it comparable between differently financed deals."
                emphasis
              />
              <ResultRow
                label={copy.calculator.capRate}
                value={formatPercent(result.capRate)}
                hint="Net operating income divided by purchase price."
              />
              <ResultRow
                label={copy.calculator.monthlyMortgage}
                value={formatCurrency(result.monthlyMortgagePayment)}
              />
              <ResultRow
                label={copy.calculator.monthlyCashFlow}
                value={formatSignedCurrency(result.monthlyCashFlow)}
                tone={cashFlowTone}
                emphasis
              />
              <ResultRow
                label={copy.calculator.cashOnCash}
                value={formatPercent(result.cashOnCashReturn)}
                hint="Annual cash flow divided by cash invested — down payment plus closing costs."
              />
              <ResultRow
                label={copy.calculator.debtServiceCoverage}
                value={formatNumber(result.debtServiceCoverageRatio, 2)}
                hint="Net operating income divided by annual mortgage payments. Lenders generally want 1.20 or better."
              />
              <ResultRow
                label={copy.calculator.breakEvenOccupancy}
                value={formatPercent(result.breakEvenOccupancy)}
                hint="The occupancy rate at which cash flow reaches zero. Lower is safer."
              />
              <ResultRow
                label={copy.calculator.totalCashInvested}
                value={formatCurrency(result.totalCashInvested)}
              />
            </ResultGroup>
          </div>

          {/* The most common question this tool raises is "why is cash flow
              negative?", and the answer is a comparison the numbers above do not
              make explicit. Stating it turns a discouraging figure into the thing
              worth understanding. */}
          <div className="mt-6 rounded-md border border-line bg-surface-2 p-4">
            <p className="eyebrow mb-2">Reading the result</p>
            <p className="text-[0.8125rem] leading-relaxed text-ink-secondary">
              The cap rate is{" "}
              <strong className="font-semibold text-ink">
                {formatPercent(result.capRate)}
              </strong>{" "}
              and the mortgage costs{" "}
              <strong className="font-semibold text-ink">
                {formatPercent(constant)}
              </strong>{" "}
              a year per dollar borrowed.{" "}
              {result.capRate >= constant
                ? "Because the property earns more than the debt costs, borrowing adds to the return — each extra dollar of financing raises the cash-on-cash figure."
                : "Because the debt costs more than the property earns, borrowing subtracts from the return at this down payment. That gap — not the rent — is what drives cash flow negative, and it is the normal condition for Montréal residential at current prices and rates. Raising the down payment, a lower rate, or a longer amortization closes it; optimistic rent assumptions do not."}
            </p>
          </div>

          <p className="mt-4 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-ink-secondary">
            Every figure here follows from the inputs and assumptions above and is
            computed in <code className="text-ink">lib/calculations/investment.ts</code>.
            It is not investment advice, it excludes income tax and capital
            expenditure, and it assumes the interest rate holds for the full
            amortization — which no fixed term does.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { copy } from "@/lib/i18n";
import {
  calculateHousingCost,
  incomeForGrossDebtServiceRatio,
  MORTGAGE_RULES_LAST_REVIEWED,
} from "@/lib/calculations/mortgage";
import { estimateClosingCosts, TRANSFER_DUTY_SOURCE } from "@/lib/calculations/transfer-tax";
import { DEFAULT_INVESTMENT_ASSUMPTIONS } from "@/lib/calculations/investment";
import { formatCurrency, formatPercent } from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NumberField, RangeField } from "@/components/ui/number-field";
import { Button } from "@/components/ui/button";
import { ResultGroup, ResultRow } from "./result-row";

/**
 * Mortgage and total-cost calculator.
 *
 * The market data on the surrounding page is synthetic. This is not: it runs the
 * real Canadian payment formula, including semi-annual compounding and mortgage
 * default insurance. That separation is the point — a reader should be able to
 * trust the arithmetic even while the market context around it is a placeholder.
 */
export function AffordabilityCalculator({
  defaultPrice,
  defaultCondoFees = 0,
  neighbourhoodName,
}: {
  defaultPrice: number;
  defaultCondoFees?: number;
  neighbourhoodName?: string;
}) {
  const initial = useMemo(
    () => ({
      purchasePrice: Math.round(defaultPrice / 1000) * 1000,
      downPaymentPercent: 20,
      interestRate: 4.75,
      amortizationYears: 25,
      annualPropertyTaxes:
        Math.round(
          (defaultPrice * DEFAULT_INVESTMENT_ASSUMPTIONS.propertyTaxRateOfPrice) / 100,
        ) * 100,
      monthlyCondoFees: defaultCondoFees,
      annualInsurance: 900,
      monthlyUtilities: 150,
    }),
    [defaultPrice, defaultCondoFees],
  );

  const [inputs, setInputs] = useState(initial);
  const set = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) =>
    setInputs((current) => ({ ...current, [key]: value }));

  const downPayment = (inputs.purchasePrice * inputs.downPaymentPercent) / 100;

  const result = calculateHousingCost({
    purchasePrice: inputs.purchasePrice,
    downPayment,
    interestRate: inputs.interestRate,
    amortizationYears: inputs.amortizationYears,
    annualPropertyTaxes: inputs.annualPropertyTaxes,
    monthlyCondoFees: inputs.monthlyCondoFees,
    annualInsurance: inputs.annualInsurance,
    monthlyUtilities: inputs.monthlyUtilities,
  });

  const closing = estimateClosingCosts(inputs.purchasePrice);
  const qualifyingIncome = incomeForGrossDebtServiceRatio(result.qualifyingMonthlyCost);

  return (
    <Card>
      <CardHeader
        title={copy.buyPage.calculatorTitle}
        description={copy.buyPage.calculatorSubtitle}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setInputs(initial)}>
            {copy.actions.reset}
          </Button>
        }
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            {neighbourhoodName ? (
              <p className="text-[0.75rem] text-ink-muted">
                Prefilled from the {neighbourhoodName} demo median. Change anything.
              </p>
            ) : null}

            <NumberField
              label={copy.calculator.purchasePrice}
              value={inputs.purchasePrice}
              onChange={(value) => set("purchasePrice", value)}
              prefix="$"
              step={5000}
            />

            <RangeField
              label={`${copy.calculator.downPayment} — ${formatCurrency(downPayment)}`}
              value={inputs.downPaymentPercent}
              onChange={(value) => set("downPaymentPercent", value)}
              min={5}
              max={50}
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                hint="Zero for a house or plex."
              />
              <NumberField
                label={copy.calculator.insurance}
                value={inputs.annualInsurance}
                onChange={(value) => set("annualInsurance", value)}
                prefix="$"
                step={50}
              />
              <NumberField
                label={copy.calculator.utilities}
                value={inputs.monthlyUtilities}
                onChange={(value) => set("monthlyUtilities", value)}
                prefix="$"
                step={10}
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-md border border-line bg-surface-2 p-4">
              <ResultGroup title={copy.calculator.monthlyMortgage}>
                <p className="text-[2rem] leading-tight font-semibold tracking-[-0.025em] text-ink">
                  {formatCurrency(result.monthlyMortgage)}
                  <span className="ml-1.5 text-[0.875rem] font-normal text-ink-muted">
                    / month
                  </span>
                </p>
                <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-muted">
                  {copy.calculator.semiAnnualNote}
                </p>
              </ResultGroup>

              <div className="mt-4 border-t border-line pt-2">
                <ResultRow
                  label={copy.calculator.loanAmount}
                  value={formatCurrency(result.mortgage.totalLoanAmount)}
                />
                {result.mortgage.insurancePremium > 0 ? (
                  <ResultRow
                    label={copy.calculator.insurancePremium}
                    value={formatCurrency(result.mortgage.insurancePremium)}
                    hint="Required below a 20% down payment. Added to the amount borrowed rather than paid up front."
                  />
                ) : null}
                <ResultRow
                  label={copy.calculator.totalInterest}
                  value={formatCurrency(result.mortgage.totalInterestOverTerm)}
                  hint="Assumes this rate holds for the whole amortization, which no fixed term actually does."
                />
              </div>
            </div>

            <ResultGroup title={copy.calculator.totalMonthlyCost}>
              <ResultRow
                label={copy.calculator.monthlyMortgage}
                value={formatCurrency(result.monthlyMortgage)}
              />
              <ResultRow
                label={copy.calculator.propertyTaxes}
                value={formatCurrency(result.monthlyPropertyTaxes)}
              />
              {result.monthlyCondoFees > 0 ? (
                <ResultRow
                  label={copy.calculator.condoFees}
                  value={formatCurrency(result.monthlyCondoFees)}
                />
              ) : null}
              <ResultRow
                label={copy.calculator.insurance}
                value={formatCurrency(result.monthlyInsurance)}
              />
              <ResultRow
                label={copy.calculator.utilities}
                value={formatCurrency(result.monthlyUtilities)}
              />
              <ResultRow
                label={copy.calculator.totalMonthlyCost}
                value={formatCurrency(result.totalMonthlyCost)}
                emphasis
              />
            </ResultGroup>

            <ResultGroup title="One-time costs at closing">
              <ResultRow
                label={copy.calculator.transferDuty}
                value={formatCurrency(closing.transferDuty)}
                hint="Progressive duty charged on the greater of price and municipal assessment."
              />
              <ResultRow
                label="Notary, inspection and adjustments"
                value={formatCurrency(closing.otherCosts)}
                hint="A flat allowance, not a quote."
              />
              <ResultRow
                label="Estimated closing costs"
                value={formatCurrency(closing.total)}
                emphasis
              />
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-muted">
                Transfer-duty brackets in this build are a demo assumption and are
                indexed annually.{" "}
                <a
                  href={TRANSFER_DUTY_SOURCE.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-accent"
                >
                  Check the current brackets
                </a>{" "}
                before relying on this figure.
              </p>
            </ResultGroup>

            <ResultGroup title={copy.calculator.qualifyingIncome}>
              <ResultRow
                label="Annual gross household income"
                value={formatCurrency(qualifyingIncome)}
                emphasis
              />
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-muted">
                {copy.calculator.qualifyingIncomeNote}
              </p>
            </ResultGroup>

            {result.mortgage.warnings.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/8 p-3">
                <p className="text-[0.6875rem] font-semibold tracking-[0.04em] text-warning-ink uppercase">
                  Worth knowing
                </p>
                <ul className="mt-2 space-y-1.5">
                  {result.mortgage.warnings.map((warning) => (
                    <li
                      key={warning}
                      className="text-[0.75rem] leading-relaxed text-ink-secondary"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[0.625rem] text-ink-muted">
                  Rules last reviewed {MORTGAGE_RULES_LAST_REVIEWED}. Federal mortgage
                  policy changes; verify before acting.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

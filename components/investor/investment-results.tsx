import type { InvestorAnalysis } from "@/lib/calculations/investor-analysis";
import { copy } from "@/lib/i18n";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
} from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ResultGroup, ResultRow } from "@/components/calculators/result-row";

/**
 * The investment analysis, driven by the selected lender's financing.
 *
 * Four groups in the order a purchase actually happens: what it costs to
 * acquire, what it earns, what it costs to run, and what that leaves. The
 * cap-rate-versus-mortgage-constant reading at the bottom is the single most
 * useful line on the page and is kept verbatim from the original calculator —
 * it is the answer to "why is cash flow negative", and the answer does not
 * change because the financing got more detailed.
 */
export function InvestmentResults({
  analysis,
  lenderName,
}: {
  analysis: InvestorAnalysis;
  /** Whose rate produced these figures. Named so the numbers are traceable. */
  lenderName?: string;
}) {
  const { financing, investment } = analysis;
  const constant = analysis.mortgageConstant;
  const cashFlowTone = investment.monthlyCashFlow >= 0 ? "good" : "critical";

  return (
    <Card>
      <CardHeader
        title={copy.investPage.resultsTitle}
        description={
          lenderName
            ? `Financed at ${lenderName}'s demo rate over a ${financing.input.termYears}-year term.`
            : undefined
        }
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 xl:grid-cols-4">
          <ResultGroup title={copy.financing.acquisitionTitle}>
            <ResultRow
              label={copy.calculator.purchasePrice}
              value={formatCurrency(financing.input.purchasePrice)}
            />
            <ResultRow
              label={copy.calculator.downPayment}
              value={formatCurrency(financing.downPayment)}
            />
            <ResultRow
              label={copy.financing.baseMortgage}
              value={formatCurrency(financing.baseMortgage)}
            />
            <ResultRow
              label={copy.financing.insurancePremium}
              value={
                financing.insurancePremium > 0
                  ? formatCurrency(financing.insurancePremium)
                  : "None"
              }
              hint="Required below a 20% down payment. Added to the amount borrowed rather than paid at closing."
            />
            <ResultRow
              label={copy.financing.financedMortgage}
              value={formatCurrency(financing.financedMortgage)}
            />
            <ResultRow
              label={copy.financing.closingCosts}
              value={formatCurrency(investment.totalCashInvested - financing.downPayment)}
            />
            <ResultRow
              label={copy.financing.totalCashRequired}
              value={formatCurrency(analysis.totalCashRequired)}
              emphasis
            />
          </ResultGroup>

          <ResultGroup title={copy.investPage.incomeTitle}>
            <ResultRow
              label={copy.calculator.monthlyRent}
              value={formatCurrency(financing.input.purchasePrice > 0 ? investment.grossAnnualRent / 12 : 0)}
            />
            <ResultRow
              label={copy.calculator.grossAnnualRent}
              value={formatCurrency(investment.grossAnnualRent)}
              hint="Twelve months of rent at full occupancy, before any allowance."
            />
            <ResultRow
              label={`Vacancy allowance (${formatPercent(investment.assumptions.vacancyAllowancePercent)})`}
              value={`−${formatCurrency(investment.assumptions.vacancyAllowanceDollars)}`}
            />
            <ResultRow
              label={copy.calculator.effectiveGrossIncome}
              value={formatCurrency(investment.effectiveGrossIncome)}
              emphasis
            />
            <ResultRow
              label={copy.calculator.grossYield}
              value={formatPercent(investment.grossRentalYield)}
              hint="Gross annual rent divided by purchase price. Ignores every expense, which is why it always flatters a property."
            />
          </ResultGroup>

          <ResultGroup title={copy.investPage.expensesTitle}>
            <ResultRow
              label="Municipal and school taxes"
              value={formatCurrency(investment.expenses.propertyTaxes)}
            />
            <ResultRow
              label={copy.calculator.insurance}
              value={formatCurrency(investment.expenses.insurance)}
            />
            <ResultRow
              label={copy.calculator.maintenance}
              value={formatCurrency(investment.expenses.maintenance)}
            />
            {investment.expenses.condoFees > 0 ? (
              <ResultRow
                label={copy.calculator.condoFees}
                value={formatCurrency(investment.expenses.condoFees)}
              />
            ) : null}
            {investment.expenses.management > 0 ? (
              <ResultRow
                label={copy.calculator.managementFee}
                value={formatCurrency(investment.expenses.management)}
              />
            ) : null}
            {investment.expenses.other > 0 ? (
              <ResultRow
                label={copy.financing.otherExpenses}
                value={formatCurrency(investment.expenses.other)}
              />
            ) : null}
            <ResultRow
              label={copy.calculator.totalExpenses}
              value={formatCurrency(investment.totalAnnualExpenses)}
              emphasis
            />
            <ResultRow
              label="Operating expense ratio"
              value={formatPercent(investment.operatingExpenseRatio)}
              hint="Operating expenses as a share of collected rent. Much below 30% usually means something has been left out."
            />
          </ResultGroup>

          <ResultGroup title={copy.financing.performanceTitle}>
            <ResultRow
              label={copy.calculator.netOperatingIncome}
              value={formatCurrency(investment.netOperatingIncome)}
              hint="Income after operating expenses but before financing — which is what makes it comparable between differently financed deals."
              emphasis
            />
            <ResultRow
              label={copy.calculator.capRate}
              value={formatPercent(investment.capRate)}
              hint="Net operating income divided by purchase price."
            />
            <ResultRow
              label={copy.calculator.monthlyMortgage}
              value={formatCurrency(investment.monthlyMortgagePayment)}
            />
            <ResultRow
              label={copy.financing.mortgageConstantLabel}
              value={formatPercent(constant)}
              hint="Annual payments divided by the amount borrowed — the cost of the debt, comparable directly against the cap rate."
            />
            <ResultRow
              label={copy.calculator.monthlyCashFlow}
              value={formatSignedCurrency(investment.monthlyCashFlow)}
              tone={cashFlowTone}
              emphasis
            />
            <ResultRow
              label={copy.calculator.annualCashFlow}
              value={formatSignedCurrency(investment.annualCashFlow)}
              tone={cashFlowTone}
            />
            <ResultRow
              label={copy.calculator.cashOnCash}
              value={formatPercent(investment.cashOnCashReturn)}
              hint="Annual cash flow divided by cash invested — down payment plus closing costs."
            />
            <ResultRow
              label={copy.calculator.debtServiceCoverage}
              value={formatNumber(investment.debtServiceCoverageRatio, 2)}
              hint="Net operating income divided by annual mortgage payments. Lenders generally want 1.20 or better."
            />
            <ResultRow
              label={copy.calculator.breakEvenOccupancy}
              value={formatPercent(investment.breakEvenOccupancy)}
              hint="The occupancy rate at which cash flow reaches zero. Lower is safer."
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
              {formatPercent(investment.capRate)}
            </strong>{" "}
            and the mortgage costs{" "}
            <strong className="font-semibold text-ink">{formatPercent(constant)}</strong>{" "}
            a year per dollar borrowed.{" "}
            {investment.capRate >= constant
              ? "Because the property earns more than the debt costs, borrowing adds to the return — each extra dollar of financing raises the cash-on-cash figure."
              : "Because the debt costs more than the property earns, borrowing subtracts from the return at this down payment. That gap — not the rent — is what drives cash flow negative, and it is the normal condition for Montréal residential at current prices and rates. Raising the down payment, a lower rate, or a longer amortization closes it; optimistic rent assumptions do not."}
          </p>
        </div>

        <p className="mt-4 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-ink-secondary">
          Every figure here follows from the inputs and assumptions above and is
          computed in{" "}
          <code className="text-ink">lib/calculations/investor-analysis.ts</code>. It is
          not investment advice, it excludes income tax and capital expenditure, and it
          assumes the interest rate holds for the full amortization — which no fixed
          term does.
        </p>
      </CardBody>
    </Card>
  );
}

import type { LenderFinancing } from "@/lib/calculations/financing";
import { copy } from "@/lib/i18n";
import { formatCurrency, formatPercent, formatRate } from "@/lib/calculations/format";
import { RateQualityBadge } from "./rate-badge";

/**
 * The full financing breakdown for one lender.
 *
 * Everything shown is read straight off the scenario the calculation layer
 * produced — this component does no arithmetic of its own, which is what makes
 * the same figures reachable from `/api/mortgage/compare` without rendering
 * anything.
 */
export function LenderDetail({ row }: { row: LenderFinancing }) {
  const { scenario, rate, lender } = row;

  return (
    <div className="rounded-md border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
          {lender.name}
        </h4>
        <RateQualityBadge
          quality={rate.dataQuality}
          effectiveDate={rate.effectiveDate}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-0 sm:grid-cols-2">
        <Group title="Terms">
          <Line label="Demo mortgage rate" value={formatRate(rate.rate)} />
          <Line
            label={copy.financing.productType}
            value={rate.productType === "fixed" ? copy.financing.fixed : copy.financing.variable}
          />
          <Line label={copy.financing.term} value={`${rate.termYears} ${copy.calculator.years}`} />
          <Line
            label={copy.calculator.amortization}
            value={`${scenario.input.amortizationYears} ${copy.calculator.years}`}
          />
          <Line
            label="Priced as"
            value={rate.borrowerProfile === "insured" ? "Insured" : "Conventional"}
          />
        </Group>

        <Group title="Amount borrowed">
          <Line
            label={copy.calculator.downPayment}
            value={`${formatCurrency(scenario.downPayment)} (${formatPercent(scenario.input.downPaymentPercent)})`}
          />
          <Line label={copy.financing.baseMortgage} value={formatCurrency(scenario.baseMortgage)} />
          <Line
            label={copy.financing.insurancePremium}
            value={
              scenario.insurancePremium > 0
                ? formatCurrency(scenario.insurancePremium)
                : "None — 20% or more down"
            }
          />
          <Line
            label={copy.financing.financedMortgage}
            value={formatCurrency(scenario.financedMortgage)}
            strong
          />
          <Line label={copy.financing.loanToValue} value={formatPercent(scenario.loanToValue)} />
        </Group>

        <Group title="Payments">
          <Line
            label={copy.financing.monthlyPayment}
            value={formatCurrency(scenario.payments.monthly)}
            strong
          />
          <Line
            label={copy.financing.biWeeklyPayment}
            value={formatCurrency(scenario.payments.biWeekly)}
          />
          <Line
            label={copy.financing.acceleratedBiWeekly}
            value={formatCurrency(scenario.payments.acceleratedBiWeekly)}
          />
          <p className="pt-1 pb-2 text-[0.6875rem] leading-relaxed text-ink-muted">
            {copy.financing.acceleratedNote} That is{" "}
            {formatCurrency(scenario.payments.acceleratedAnnualExtra)} more per year
            against the balance.
          </p>
        </Group>

        <Group title={`Over the ${rate.termYears}-year term`}>
          <Line
            label={copy.financing.principalOverTerm}
            value={formatCurrency(scenario.term.principalPaid)}
          />
          <Line
            label={copy.financing.interestOverTerm}
            value={formatCurrency(scenario.term.interestPaid)}
          />
          <Line
            label={copy.financing.balanceEndOfTerm}
            value={formatCurrency(scenario.term.balanceAtEndOfTerm)}
            strong
          />
          <Line
            label={copy.financing.mortgageConstantLabel}
            value={formatPercent(scenario.mortgageConstant)}
          />
        </Group>
      </div>

      <p className="mt-3 border-t border-line pt-3 text-[0.6875rem] leading-relaxed text-ink-muted">
        Term figures follow the monthly schedule. Choosing accelerated bi-weekly
        payments would leave a smaller balance at the end of the term than the one
        shown.
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <p className="eyebrow mb-1.5">{title}</p>
      <dl>{children}</dl>
    </div>
  );
}

function Line({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-[0.75rem] text-ink-secondary">{label}</dt>
      <dd
        className={
          strong
            ? "shrink-0 text-[0.875rem] font-semibold tabular text-ink"
            : "shrink-0 text-[0.8125rem] font-medium tabular text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}

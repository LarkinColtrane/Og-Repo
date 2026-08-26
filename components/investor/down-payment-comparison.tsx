"use client";

import type { FinancingScenario } from "@/lib/calculations/financing";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
} from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NumberField } from "@/components/ui/number-field";
import { Badge } from "@/components/ui/badge";

export interface DownPaymentOption {
  /** `5`, `10`, `20`, or the current custom value. */
  percent: number;
  label: string;
  isCustom: boolean;
  scenario: FinancingScenario;
  /** Cash flow for this scenario, from the investment analysis. */
  monthlyCashFlow: number;
  annualCashFlow: number;
  cashOnCashReturn: number;
  totalCashRequired: number;
}

/**
 * Side-by-side down-payment scenarios.
 *
 * The ineligible ones are rendered, not hidden. A 5% card that says why it is
 * unavailable teaches the rule; a 5% card that quietly disappears just raises a
 * question. Selecting an ineligible level is blocked rather than merely
 * discouraged — the figures behind it would be hypothetical, and there is no
 * honest way to label a number for a mortgage nobody would write.
 */
export function DownPaymentComparison({
  options,
  selectedPercent,
  onSelect,
  customPercent,
  onCustomChange,
}: {
  options: DownPaymentOption[];
  selectedPercent: number;
  onSelect: (percent: number) => void;
  customPercent: number;
  onCustomChange: (percent: number) => void;
}) {
  return (
    <Card>
      <CardHeader
        title={copy.financing.downPaymentTitle}
        description={copy.financing.downPaymentSubtitle}
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {options.map((option) => (
            <ScenarioCard
              key={option.label}
              option={option}
              selected={Math.abs(option.percent - selectedPercent) < 0.001}
              onSelect={() => onSelect(option.percent)}
            />
          ))}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <div className="max-w-[16rem]">
            <NumberField
              label={`${copy.financing.custom} down payment`}
              value={customPercent}
              onChange={onCustomChange}
              suffix="%"
              step={0.5}
              min={0}
              max={100}
              hint="Selecting the custom card applies this percentage."
            />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ScenarioCard({
  option,
  selected,
  onSelect,
}: {
  option: DownPaymentOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { scenario } = option;
  const eligible = scenario.eligibility.eligible;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!eligible}
      aria-pressed={selected}
      className={cn(
        "flex h-full flex-col rounded-md border p-4 text-left transition-colors",
        eligible
          ? selected
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface hover:border-line-strong"
          : "cursor-not-allowed border-dashed border-line bg-surface-inset",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "text-[1.125rem] font-semibold tracking-[-0.02em]",
            eligible ? "text-ink" : "text-ink-muted",
          )}
        >
          {option.label}
        </span>
        {!eligible ? (
          <Badge tone="neutral">{copy.financing.notEligible}</Badge>
        ) : scenario.eligibility.insured ? (
          <Badge tone="warning">Insured</Badge>
        ) : (
          <Badge tone="neutral">Conventional</Badge>
        )}
      </div>

      {!eligible ? (
        <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-secondary">
          {scenario.eligibility.blockers[0]?.message}
        </p>
      ) : (
        <dl className="mt-3 space-y-1.5">
          <Row label="Down payment" value={formatCurrency(scenario.downPayment)} />
          <Row label={copy.financing.baseMortgage} value={formatCurrency(scenario.baseMortgage)} />
          {scenario.insurancePremium > 0 ? (
            <Row
              label={copy.financing.insurancePremium}
              value={formatCurrency(scenario.insurancePremium)}
            />
          ) : null}
          <Row
            label={copy.financing.financedMortgage}
            value={formatCurrency(scenario.financedMortgage)}
            strong
          />
          <Row
            label={copy.financing.monthlyPayment}
            value={formatCurrency(scenario.payments.monthly)}
            strong
          />
          <Row
            label={copy.financing.totalCashRequired}
            value={formatCurrency(option.totalCashRequired)}
          />
          <Row
            label="Monthly cash flow"
            value={formatSignedCurrency(option.monthlyCashFlow)}
            tone={option.monthlyCashFlow >= 0 ? "good" : "critical"}
          />
          <Row
            label={copy.calculator.cashOnCash}
            value={formatPercent(option.cashOnCashReturn)}
            tone={option.cashOnCashReturn >= 0 ? "good" : "critical"}
          />
        </dl>
      )}
    </button>
  );
}

function Row({
  label,
  value,
  strong = false,
  tone = "default",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "good" | "critical";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[0.75rem] text-ink-secondary">{label}</dt>
      <dd
        className={cn(
          "shrink-0 text-[0.8125rem] tabular",
          strong ? "font-semibold text-ink" : "font-medium",
          tone === "good"
            ? "text-good-ink"
            : tone === "critical"
              ? "text-critical-ink"
              : strong
                ? "text-ink"
                : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

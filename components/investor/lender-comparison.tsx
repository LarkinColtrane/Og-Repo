"use client";

import { useState } from "react";
import type { LenderComparison, LenderFinancing } from "@/lib/calculations/financing";
import type { BenchmarkObservation } from "@/types/benchmark";
import { calculateMortgageSpread } from "@/lib/calculations/benchmark";
import { copy, interpolate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent, formatRate } from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { LenderDetail } from "./lender-detail";
import { RateQualityBadge } from "./rate-badge";

/**
 * Every lender priced against the selected scenario.
 *
 * Two flags are computed and shown — lowest payment and lowest rate — and
 * neither is called "best". They are different lenders often enough that the
 * distinction is worth surfacing: a lower rate on an insured mortgage can still
 * cost more per month once the premium is financed. The disclaimer under the
 * list is not boilerplate; it names the things a payment comparison genuinely
 * cannot see.
 */
export function LenderComparisonPanel({
  comparison,
  scenarioSummary,
  selectedLenderId,
  onSelectLender,
  benchmark,
}: {
  comparison: LenderComparison;
  /** Price / down payment / base mortgage line shown above the list. */
  scenarioSummary: { price: number; downPaymentPercent: number; baseMortgage: number };
  selectedLenderId: string | null;
  onSelectLender: (lenderId: string) => void;
  /**
   * The latest 5-year Government of Canada bond yield, when one is on record.
   *
   * Optional: the comparison works without it, and a missing benchmark shows no
   * spread rather than a placeholder. The spread is derived on render and never
   * stored — it is the difference between two numbers that both already exist.
   */
  benchmark?: BenchmarkObservation | null;
}) {
  const [openLenderId, setOpenLenderId] = useState<string | null>(null);

  const eligible = comparison.lenders.filter((row) => row.scenario.eligibility.eligible);

  // Derived on render, never stored: the spread is the difference between two
  // numbers the page already has, and persisting it would be a third value to
  // keep in step with both.
  const spreadFor = (row: LenderFinancing) =>
    calculateMortgageSpread({
      rate: row.rate,
      benchmark: benchmark ?? null,
      benchmarkTermYears: 5,
    });

  return (
    <Card>
      <CardHeader
        title={copy.financing.lenderTitle}
        description={copy.financing.lenderSubtitle}
      />
      <CardBody>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-line pb-4">
          <Summary label="Property" value={formatCurrency(scenarioSummary.price)} />
          <Summary
            label={copy.calculator.downPayment}
            value={formatPercent(scenarioSummary.downPaymentPercent)}
          />
          <Summary
            label={copy.financing.baseMortgage}
            value={formatCurrency(scenarioSummary.baseMortgage)}
          />
        </div>

        {eligible.length === 0 ? (
          <EmptyState
            className="mt-4"
            title={copy.financing.notEligible}
            body={
              comparison.reference.eligibility.blockers[0]?.message ??
              "No lender can be priced for this scenario."
            }
          />
        ) : (
          <>
            <ul className="mt-2 divide-y divide-line">
              {comparison.lenders.map((row) => {
                const open = openLenderId === row.lender.id;
                const selected = selectedLenderId === row.lender.id;
                const isEligible = row.scenario.eligibility.eligible;
                const spread = spreadFor(row);

                return (
                  <li key={row.lender.id} className="py-3">
                    {/* Stacked below `sm`. Side by side, the rate metadata gets
                        squeezed into a column narrow enough to wrap one word per
                        line — the payment and the buttons need the width more
                        than the alignment does. */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 sm:flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
                            {row.lender.shortName}
                          </span>
                          {selected ? (
                            <Badge tone="accent">{copy.financing.selectedLender}</Badge>
                          ) : null}
                          {row.isLowestPayment ? (
                            <Badge tone="good">{copy.financing.lowestPaymentShort}</Badge>
                          ) : null}
                          {row.isLowestRate && !row.isLowestPayment ? (
                            <Badge tone="neutral">{copy.financing.lowestRateShort}</Badge>
                          ) : null}
                        </div>

                        <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-secondary">
                          <span className="text-[0.8125rem] font-medium tabular text-ink">
                            {formatRate(row.rate.rate)}
                          </span>
                          <span aria-hidden="true"> · </span>
                          {row.rate.termYears}-year{" "}
                          {row.rate.productType === "fixed"
                            ? copy.financing.fixed.toLowerCase()
                            : copy.financing.variable.toLowerCase()}
                          {row.rate.borrowerProfile === "insured"
                            ? ", insured pricing"
                            : ", conventional pricing"}
                        </p>

                        {/* The spread and the provenance badge share a row with
                            an explicit gap. Left as adjacent inline elements they
                            butt together, and "1.67%●Demo rate" reads as one
                            token. */}
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          {/* Only appears for a 5-year fixed product. A variable
                              rate tracks prime, not the bond curve, so the
                              calculation returns null and nothing is drawn. */}
                          {spread ? (
                            <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-[0.75rem] text-ink-muted">
                              <span>{copy.benchmark.bondYieldLabel}</span>
                              <span className="tabular">
                                {formatRate(spread.benchmarkValue)}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{copy.benchmark.spreadLabel}</span>
                              <span className="font-semibold tabular text-ink-secondary">
                                {formatRate(spread.spread)}
                              </span>
                            </span>
                          ) : null}

                          <RateQualityBadge
                            quality={row.rate.dataQuality}
                            effectiveDate={row.rate.effectiveDate}
                          />
                        </div>

                      </div>

                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <div className="sm:text-right">
                          <p className="text-[1.0625rem] font-semibold tracking-[-0.015em] tabular text-ink">
                            {isEligible
                              ? formatCurrency(row.scenario.payments.monthly)
                              : "—"}
                            {isEligible ? (
                              <span className="ml-0.5 text-[0.75rem] font-normal text-ink-muted">
                                {copy.financing.perMonth}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-[0.6875rem] text-ink-muted">
                            {isEligible
                              ? `${formatCurrency(row.scenario.payments.acceleratedBiWeekly)} accelerated bi-weekly`
                              : copy.financing.notEligible}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            disabled={!isEligible}
                            onClick={() => onSelectLender(row.lender.id)}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-[0.75rem] font-medium transition-colors",
                              selected
                                ? "border-accent bg-accent-soft text-accent"
                                : "border-line-strong text-ink-secondary hover:border-accent hover:text-accent",
                              !isEligible && "cursor-not-allowed opacity-40",
                            )}
                          >
                            {selected
                              ? copy.financing.selectedLender
                              : copy.financing.selectLender}
                          </button>
                          <button
                            type="button"
                            disabled={!isEligible}
                            aria-expanded={open}
                            onClick={() => setOpenLenderId(open ? null : row.lender.id)}
                            className={cn(
                              "rounded-md px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap text-ink-muted transition-colors hover:text-accent",
                              !isEligible && "cursor-not-allowed opacity-40",
                            )}
                          >
                            {open ? copy.financing.hideDetail : copy.financing.viewDetail}
                          </button>
                        </div>
                      </div>
                    </div>

                    {open && isEligible ? (
                      <div className="mt-3">
                        <LenderDetail row={row} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 space-y-2 border-t border-line pt-4">
              {comparison.paymentSpread > 0 ? (
                <p className="text-[0.8125rem] text-ink-secondary">
                  {interpolate(copy.financing.spreadNote, {
                    spread: formatCurrency(comparison.paymentSpread),
                  })}
                </p>
              ) : null}
              <p className="text-[0.75rem] leading-relaxed text-ink-muted">
                <span className="font-semibold text-ink-secondary">
                  {copy.financing.lowestPayment}.
                </span>{" "}
                {copy.financing.notBestBank}
              </p>
              {benchmark && comparison.lenders.some((row) => row.rate.productType !== "fixed") ? (
                <p className="text-[0.75rem] leading-relaxed text-ink-muted">
                  {copy.benchmark.variableNote}
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 text-[1rem] font-semibold tracking-[-0.015em] tabular text-ink">
        {value}
      </p>
    </div>
  );
}

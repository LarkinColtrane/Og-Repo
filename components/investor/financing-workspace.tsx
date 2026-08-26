"use client";

import { useCallback, useMemo, useState } from "react";
import type { Lender, MortgageRate } from "@/types/mortgage";
import type { BenchmarkSeriesPayload } from "@/types/benchmark";
import { copy } from "@/lib/i18n";
import { formatPercent } from "@/lib/calculations/format";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import {
  assessEligibility,
  borrowerProfileFor,
  buildFinancingMatrix,
  compareLenders,
} from "@/lib/calculations/financing";
import { analyseInvestment } from "@/lib/calculations/investor-analysis";
import { Stack } from "@/components/ui/section";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { PropertyInputs } from "./property-inputs";
import { DownPaymentComparison, type DownPaymentOption } from "./down-payment-comparison";
import { LenderComparisonPanel } from "./lender-comparison";
import { FinancingMatrixPanel } from "./financing-matrix";
import { InvestmentResults } from "./investment-results";
import { RateDataNotice, toRateQuality } from "./rate-badge";
import { BenchmarkPanel } from "./benchmark-panel";
import {
  createFormState,
  DOWN_PAYMENT_PRESETS,
  toAnalysisInput,
  type FinancingFormState,
  type FormSeed,
} from "./financing-state";

/**
 * The investor workspace: inputs, down-payment scenarios, lender comparison,
 * the leverage matrix, and the investment analysis, all driven by one state
 * object.
 *
 * **Where the work happens.** Lenders and rates arrive over HTTP — a real
 * request to `/api/mortgage/rates` whenever the product or term changes.
 * Everything else is computed locally from those rates by the same pure
 * functions `/api/mortgage/compare` calls on the server. That split is
 * deliberate: fetching per keystroke would make a slider unusable, and
 * duplicating the arithmetic in the browser would let the two answers drift.
 * One implementation, two callers, one round trip per filter change.
 */
export function FinancingWorkspace({
  seed,
  prefillNote,
}: {
  seed: FormSeed;
  /** Where the opening numbers came from. */
  prefillNote?: string;
}) {
  const [form, setForm] = useState<FinancingFormState>(() => createFormState(seed));
  const [customPercent, setCustomPercent] = useState(15);
  const [selectedLenderId, setSelectedLenderId] = useState<string | null>(null);

  const update = useCallback(
    <K extends keyof FinancingFormState>(key: K, next: FinancingFormState[K]) => {
      setForm((current) => {
        const updated = { ...current, [key]: next };

        // A variable product is only offered on a subset of terms. Switching
        // product with an unavailable term selected would ask the API for a rate
        // that does not exist, so the term is corrected here rather than left to
        // fail as an empty comparison.
        if (key === "productType" && next === "variable" && ![3, 5].includes(updated.termYears)) {
          updated.termYears = 5;
        }
        return updated;
      });
    },
    [],
  );

  const resetForm = useCallback(() => {
    setForm(createFormState(seed));
    setSelectedLenderId(null);
  }, [seed]);

  const lendersResource = useApiResource<Lender[]>(
    "mortgage:lenders",
    useCallback((signal: AbortSignal) => api.lenders(signal), []),
  );

  const ratesFetcher = useCallback(
    (signal: AbortSignal) =>
      api.mortgageRates(
        { productType: form.productType, termYears: form.termYears },
        signal,
      ),
    [form.productType, form.termYears],
  );

  const ratesResource = useApiResource<MortgageRate[]>(
    `mortgage:rates:${form.productType}:${form.termYears}`,
    ratesFetcher,
  );

  // The latest benchmark, fetched once for the spread column. The panel below
  // fetches its own history because its range control changes independently —
  // this request only needs the newest observation.
  const benchmarkResource = useApiResource<BenchmarkSeriesPayload>(
    "benchmark:5y:latest",
    useCallback(
      (signal: AbortSignal) =>
        api.benchmark({ series: "5y-canada-bond", range: "3m" }, signal),
      [],
    ),
  );

  const lenders = useMemo(() => lendersResource.data ?? [], [lendersResource.data]);
  const rates = useMemo(() => ratesResource.data ?? [], [ratesResource.data]);
  const ready = lenders.length > 0 && rates.length > 0;

  /** Shared by the scenario cards, the comparison and the matrix. */
  const baseInput = useMemo(
    () => ({
      purchasePrice: form.purchasePrice,
      amortizationYears: form.amortizationYears,
      termYears: form.termYears,
      occupancy: form.occupancy,
      units: form.units,
    }),
    [form.purchasePrice, form.amortizationYears, form.termYears, form.occupancy, form.units],
  );

  const comparison = useMemo(
    () =>
      ready
        ? compareLenders({
            input: { ...baseInput, downPaymentPercent: form.downPaymentPercent },
            lenders,
            rates,
          })
        : null,
    [ready, baseInput, form.downPaymentPercent, lenders, rates],
  );

  /**
   * The lender whose rate drives the analysis: the reader's choice when it is
   * still eligible, otherwise the lowest payment. Derived rather than stored, so
   * changing the property cannot strand a selection that no longer applies.
   */
  const activeLenderId = useMemo(() => {
    if (!comparison || comparison.lenders.length === 0) return null;
    const chosen = comparison.lenders.find(
      (row) => row.lender.id === selectedLenderId && row.scenario.eligibility.eligible,
    );
    // The final fallback matters more than it looks. Switching to an investment
    // purchase makes 5% and 10% ineligible, so no lender is eligible at the
    // current level and `lowestPaymentLenderId` is null. Falling back to the
    // first lender keeps the scenario cards rendered — which is the only way
    // back to a level that does work. Without it the picker disappears at
    // exactly the moment the reader needs it.
    return (
      chosen?.lender.id ??
      comparison.lowestPaymentLenderId ??
      comparison.lenders[0].lender.id
    );
  }, [comparison, selectedLenderId]);

  const activeRow = comparison?.lenders.find((row) => row.lender.id === activeLenderId);

  /** Price one down-payment level at the active lender. */
  const optionFor = useCallback(
    (percent: number, label: string, isCustom: boolean): DownPaymentOption | null => {
      if (!activeLenderId) return null;

      const probe = assessEligibility({
        ...baseInput,
        downPaymentPercent: percent,
        interestRate: 0,
      });
      const profile = borrowerProfileFor(probe);
      const rate = rates.find(
        (entry) => entry.lenderId === activeLenderId && entry.borrowerProfile === profile,
      );
      if (!rate) return null;

      const analysis = analyseInvestment(
        toAnalysisInput({ ...form, downPaymentPercent: percent }, rate.rate),
      );

      return {
        percent,
        label,
        isCustom,
        scenario: analysis.financing,
        monthlyCashFlow: analysis.investment.monthlyCashFlow,
        annualCashFlow: analysis.investment.annualCashFlow,
        cashOnCashReturn: analysis.investment.cashOnCashReturn,
        totalCashRequired: analysis.totalCashRequired,
      };
    },
    [activeLenderId, baseInput, form, rates],
  );

  const downPaymentOptions = useMemo(() => {
    const options = [
      ...DOWN_PAYMENT_PRESETS.map((percent) =>
        optionFor(percent, `${percent}%`, false),
      ),
      optionFor(customPercent, `${copy.financing.custom} — ${customPercent}%`, true),
    ];
    return options.filter((option): option is DownPaymentOption => option !== null);
  }, [optionFor, customPercent]);

  const matrix = useMemo(
    () =>
      ready
        ? buildFinancingMatrix({
            input: baseInput,
            downPaymentPercents: [...DOWN_PAYMENT_PRESETS],
            lenders,
            rates,
          })
        : null,
    [ready, baseInput, lenders, rates],
  );

  const analysis = useMemo(
    () =>
      activeRow
        ? analyseInvestment(toAnalysisInput(form, activeRow.rate.rate))
        : null,
    [activeRow, form],
  );

  const error = lendersResource.error ?? ratesResource.error;
  const loading =
    (lendersResource.isInitialLoading || ratesResource.isInitialLoading) && !ready;

  return (
    <Stack>
      <RateDataNotice
        quality={toRateQuality(ratesResource.meta?.dataQuality)}
        effectiveDate={ratesResource.meta?.period}
      />

      <PropertyInputs
        value={form}
        onChange={update}
        onReset={resetForm}
        description={prefillNote}
      />

      {error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            lendersResource.reload();
            ratesResource.reload();
          }}
        />
      ) : loading ? (
        <>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </>
      ) : (
        <>
          <DownPaymentComparison
            options={downPaymentOptions}
            selectedPercent={form.downPaymentPercent}
            onSelect={(percent) => update("downPaymentPercent", percent)}
            customPercent={customPercent}
            onCustomChange={setCustomPercent}
          />

          {comparison ? (
            <LenderComparisonPanel
              comparison={comparison}
              scenarioSummary={{
                price: form.purchasePrice,
                downPaymentPercent: form.downPaymentPercent,
                baseMortgage: comparison.reference.baseMortgage,
              }}
              selectedLenderId={activeLenderId}
              onSelectLender={setSelectedLenderId}
              benchmark={benchmarkResource.data?.snapshot.latest ?? null}
            />
          ) : null}

          {matrix ? (
            <FinancingMatrixPanel
              matrix={matrix}
              selectedPercent={form.downPaymentPercent}
            />
          ) : null}

          <BenchmarkPanel />

          {analysis && analysis.financing.eligibility.eligible ? (
            <InvestmentResults
              analysis={analysis}
              lenderName={activeRow?.lender.shortName}
            />
          ) : analysis ? (
            /* Returns for a mortgage no lender would write are not a useful
               answer, and labelling them would not make them one. The blocking
               reason is shown instead — the scenario cards above are the way
               back to a level that works. */
            <EmptyState
              title={`${formatPercent(form.downPaymentPercent)} down is not available for this property`}
              body={
                analysis.financing.eligibility.blockers[0]?.message ??
                "Choose a down payment this property is eligible for to see the analysis."
              }
            />
          ) : null}
        </>
      )}
    </Stack>
  );
}

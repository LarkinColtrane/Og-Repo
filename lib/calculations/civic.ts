import type { BenchmarkFreshness } from "@/types/benchmark";
import type { Period } from "@/types";
import { monthsBetween, toPeriod } from "@/lib/periods";

/**
 * Freshness for a monthly published series.
 *
 * The counterpart to `assessBenchmarkFreshness`, and deliberately a separate
 * rule rather than the same one with a bigger number.
 *
 * ## Why months, and why the allowance is wide
 *
 * The Bank of Canada publishes every business day, so two business days of
 * silence is meaningful. A municipal extract is nothing like that: it is
 * regenerated when somebody regenerates it, a monthly file can land three weeks
 * into the following month, and December's data routinely appears in February.
 *
 * A rule tuned to a daily series would mark municipal data stale most of the
 * time, and an interface that says "stale" most of the time has stopped saying
 * anything. Three months is wide enough to absorb normal municipal publication
 * and narrow enough that a genuinely abandoned feed still surfaces.
 *
 * Demo data is never live or stale — it is `demo`, a separate state, because
 * "is this current?" does not apply to a number nobody published.
 */
export function assessPeriodFreshness(options: {
  latestPeriod: Period | null;
  maxPeriodLagMonths: number;
  dataQuality: "demo" | "live";
  /** Injected so the rule is testable without mocking the clock. */
  today?: Period;
}): { freshness: BenchmarkFreshness; monthLag: number | null } {
  if (options.dataQuality === "demo") return { freshness: "demo", monthLag: null };
  if (!options.latestPeriod) return { freshness: "unavailable", monthLag: null };

  const today = options.today ?? currentPeriod();
  const lag = monthsBetween(options.latestPeriod, today);

  // A negative lag means the newest period is in the future. That is not fresh,
  // it is wrong — and the batch validator refuses such an import — but if one
  // ever reaches storage, reporting it as `stale` is the safe direction: it
  // draws attention rather than showing a green light over a broken date column.
  if (lag < 0) return { freshness: "stale", monthLag: lag };

  return {
    freshness: lag <= options.maxPeriodLagMonths ? "live" : "stale",
    monthLag: lag,
  };
}

export function currentPeriod(now: Date = new Date()): Period {
  return toPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

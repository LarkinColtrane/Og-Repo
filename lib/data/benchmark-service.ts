import type {
  BenchmarkRange,
  BenchmarkSeriesCode,
  BenchmarkSeriesPayload,
  BenchmarkSnapshot,
} from "@/types/benchmark";
import { getBenchmarkSeries } from "@/lib/pipeline/connectors/bank-of-canada/series";
import {
  assessBenchmarkFreshness,
  benchmarkRangeStart,
} from "@/lib/calculations/benchmark";
import { toIsoDate } from "@/lib/calculations/business-days";
import { getBenchmarkRepository, getImportRunStore } from "./index";

/**
 * Assembles what the interface needs to show a benchmark honestly.
 *
 * The snapshot deliberately carries *two* kinds of freshness, because they fail
 * independently and mean different things:
 *
 *  - **Data freshness** — how old the latest observation is. Answers "is this
 *    number current?"
 *  - **Pipeline health** — when an import last succeeded or failed. Answers "is
 *    anything still trying?"
 *
 * A pipeline can be green while the data is stale (the publisher paused), and
 * data can look current while every import since has failed (nothing new has
 * arrived yet). Reporting only one of them hides half the failures.
 */
export async function getBenchmarkSnapshot(
  seriesCode: BenchmarkSeriesCode,
): Promise<BenchmarkSnapshot> {
  const series = getBenchmarkSeries(seriesCode);
  const repository = getBenchmarkRepository();
  const importRuns = getImportRunStore();

  const latest = await repository.getLatest(seriesCode);
  const previous = latest
    ? await repository.getPrevious(seriesCode, latest.observationDate)
    : null;

  const { freshness, businessDayLag } = assessBenchmarkFreshness({ latest, series });
  const health = await importRuns.getHealth(series.sourceId);

  return {
    series,
    latest,
    changeFromPrevious:
      latest && previous ? Math.round((latest.value - previous.value) * 100) / 100 : null,
    freshness,
    businessDayLag,
    lastSuccessfulImportAt: health.lastSuccessAt,
    lastFailedImportAt: health.lastFailureAt,
    lastFailureMessage: health.lastFailureMessage,
  };
}

/** Snapshot plus the observations a chart range needs. */
export async function getBenchmarkPayload(
  seriesCode: BenchmarkSeriesCode,
  range: BenchmarkRange,
): Promise<BenchmarkSeriesPayload> {
  const snapshot = await getBenchmarkSnapshot(seriesCode);
  const repository = getBenchmarkRepository();

  // The window ends at the latest observation, not at today. Anchoring to today
  // would shrink the visible range whenever the data was behind, which is
  // exactly when a reader most wants to see the whole picture.
  const endDate = snapshot.latest?.observationDate ?? toIsoDate(new Date());

  const observations = await repository.getHistory({
    seriesCode,
    startDate: benchmarkRangeStart(range, endDate),
    endDate,
  });

  return { snapshot, observations, range };
}

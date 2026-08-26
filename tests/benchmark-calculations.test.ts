import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessBenchmarkFreshness,
  benchmarkRangeStart,
  benchmarkTermYears,
  calculateMortgageSpread,
} from "@/lib/calculations/benchmark";
import { getBenchmarkSeries } from "@/lib/pipeline/connectors/bank-of-canada/series";
import type { BenchmarkObservation } from "@/types/benchmark";
import type { MortgageRate } from "@/types/mortgage";

const series = getBenchmarkSeries("5y-canada-bond");

const observation = (date: string, over: Partial<BenchmarkObservation> = {}): BenchmarkObservation => ({
  seriesCode: "5y-canada-bond",
  observationDate: date,
  value: 3.21,
  source: "src-boc-valet",
  retrievedAt: "2026-06-15T09:00:00.000Z",
  dataQuality: "live",
  ...over,
});

describe("assessBenchmarkFreshness", () => {
  it("reports unavailable when there is nothing on record", () => {
    const result = assessBenchmarkFreshness({ latest: null, series, today: "2026-06-15" });
    assert.equal(result.freshness, "unavailable");
  });

  it("reports demo data as demo, never as live or stale", () => {
    const result = assessBenchmarkFreshness({
      latest: observation("2020-01-02", { dataQuality: "demo" }),
      series,
      today: "2026-06-15",
    });
    assert.equal(result.freshness, "demo", "six-year-old demo data is still demo, not stale");
  });

  it("treats today's observation as live", () => {
    const result = assessBenchmarkFreshness({
      latest: observation("2026-06-15"),
      series,
      today: "2026-06-15",
    });
    assert.equal(result.freshness, "live");
    assert.equal(result.businessDayLag, 0);
  });

  it("keeps Friday's observation live through the weekend", () => {
    // 2026-06-12 is a Friday.
    for (const today of ["2026-06-13", "2026-06-14"]) {
      const result = assessBenchmarkFreshness({
        latest: observation("2026-06-12"),
        series,
        today,
      });
      assert.equal(result.businessDayLag, 0, `${today} should be 0 business days on`);
      assert.equal(result.freshness, "live", `Friday's data must stay live on ${today}`);
    }
  });

  it("keeps Friday's observation live on Monday", () => {
    const result = assessBenchmarkFreshness({
      latest: observation("2026-06-12"),
      series,
      today: "2026-06-15",
    });
    assert.equal(result.businessDayLag, 1);
    assert.equal(result.freshness, "live");
  });

  it("does not age data across a market holiday", () => {
    // Canada Day 2026 is Wednesday 1 July. Tue 30 Jun read on Thu 2 Jul is one
    // business day, not two.
    const result = assessBenchmarkFreshness({
      latest: observation("2026-06-30"),
      series,
      today: "2026-07-02",
    });
    assert.equal(result.businessDayLag, 1);
    assert.equal(result.freshness, "live");
  });

  it("turns stale past the allowed business-day lag", () => {
    const result = assessBenchmarkFreshness({
      latest: observation("2026-06-08"),
      series,
      today: "2026-06-15",
    });
    assert.equal(result.businessDayLag, 5);
    assert.equal(result.freshness, "stale");
  });

  it("uses the series' own lag allowance", () => {
    // The policy rate can legitimately sit unchanged for weeks.
    const policy = getBenchmarkSeries("boc-policy-rate");
    const result = assessBenchmarkFreshness({
      latest: observation("2026-06-01", { seriesCode: "boc-policy-rate" }),
      series: policy,
      today: "2026-06-15",
    });
    assert.equal(result.freshness, "live", "10 business days is inside the policy-rate allowance");
  });
});

describe("benchmarkRangeStart", () => {
  it("walks back the right window", () => {
    assert.equal(benchmarkRangeStart("3m", "2026-06-15"), "2026-03-15");
    assert.equal(benchmarkRangeStart("1y", "2026-06-15"), "2025-06-15");
    // 1,095 days spans a leap day, so three years back lands a day later.
    assert.equal(benchmarkRangeStart("3y", "2026-06-15"), "2023-06-16");
    assert.equal(benchmarkRangeStart("5y", "2026-06-15"), "2021-06-15");
  });
});

const rate = (over: Partial<MortgageRate> = {}): MortgageRate => ({
  id: "demo-rbc-fixed-5-uninsured",
  lenderId: "rbc",
  productType: "fixed",
  termYears: 5,
  borrowerProfile: "uninsured",
  rate: 4.79,
  effectiveDate: "2026-06-15",
  dataSourceId: "src-demo-mortgage-rates",
  dataQuality: "demo",
  lastUpdated: "2026-06-15T09:00:00.000Z",
  ...over,
});

describe("calculateMortgageSpread", () => {
  it("computes the spread for a 5-year fixed product", () => {
    const result = calculateMortgageSpread({
      rate: rate({ rate: 4.79 }),
      benchmark: observation("2026-06-15", { value: 3.21 }),
      benchmarkTermYears: 5,
    });
    assert.ok(result);
    assert.equal(result!.spread, 1.58);
    assert.equal(result!.mortgageRate, 4.79);
    assert.equal(result!.benchmarkValue, 3.21);
    assert.equal(result!.benchmarkDate, "2026-06-15");
  });

  it("returns null for a variable product", () => {
    const result = calculateMortgageSpread({
      rate: rate({ productType: "variable", rate: 5.35 }),
      benchmark: observation("2026-06-15", { value: 3.21 }),
      benchmarkTermYears: 5,
    });
    assert.equal(result, null, "a variable rate tracks prime, not the 5-year bond");
  });

  it("returns null when the terms do not match", () => {
    const result = calculateMortgageSpread({
      rate: rate({ termYears: 3, rate: 4.99 }),
      benchmark: observation("2026-06-15", { value: 3.21 }),
      benchmarkTermYears: 5,
    });
    assert.equal(result, null, "a 3-year fixed is a different point on the curve");
  });

  it("returns null when there is no benchmark on record", () => {
    assert.equal(
      calculateMortgageSpread({ rate: rate(), benchmark: null, benchmarkTermYears: 5 }),
      null,
    );
  });

  it("handles a negative spread without hiding it", () => {
    const result = calculateMortgageSpread({
      rate: rate({ rate: 3.0 }),
      benchmark: observation("2026-06-15", { value: 3.21 }),
      benchmarkTermYears: 5,
    });
    assert.equal(result!.spread, -0.21);
  });

  it("rounds to two decimals rather than leaking float noise", () => {
    const result = calculateMortgageSpread({
      rate: rate({ rate: 4.9 }),
      benchmark: observation("2026-06-15", { value: 3.21 }),
      benchmarkTermYears: 5,
    });
    assert.equal(result!.spread, 1.69); // not 1.6900000000000004
  });
});

describe("benchmarkTermYears", () => {
  it("maps bond series to their term", () => {
    assert.equal(benchmarkTermYears("5y-canada-bond"), 5);
    assert.equal(benchmarkTermYears("10y-canada-bond"), 10);
  });

  it("has no term for the overnight policy rate", () => {
    assert.equal(benchmarkTermYears("boc-policy-rate"), null);
  });
});

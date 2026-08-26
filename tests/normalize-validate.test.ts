import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeBankOfCanadaSeries } from "@/lib/pipeline/transforms/bank-of-canada";
import { getBenchmarkSeries } from "@/lib/pipeline/connectors/bank-of-canada/series";
import {
  detectUnitAnomaly,
  validateBenchmarkObservations,
} from "@/lib/pipeline/validate";
import type { BenchmarkObservation } from "@/types/benchmark";
import { valetFiveYearFixture } from "./fixtures/valet";

const series = getBenchmarkSeries("5y-canada-bond");
const RETRIEVED = "2026-06-15T09:00:00.000Z";
const normalize = (response: Parameters<typeof normalizeBankOfCanadaSeries>[0]) =>
  normalizeBankOfCanadaSeries(response, { series, retrievedAt: RETRIEVED });

describe("normalizeBankOfCanadaSeries", () => {
  it("converts string values to numbers and stamps provenance", () => {
    const { observations } = normalize(valetFiveYearFixture);
    assert.equal(observations[0].value, 3.18);
    assert.equal(typeof observations[0].value, "number");
    assert.equal(observations[0].observationDate, "2026-04-01");
    assert.equal(observations[0].seriesCode, "5y-canada-bond");
    assert.equal(observations[0].source, "src-boc-valet");
    assert.equal(observations[0].retrievedAt, RETRIEVED);
    assert.equal(observations[0].dataQuality, "live");
  });

  it("preserves decimal precision", () => {
    const { observations } = normalize(valetFiveYearFixture);
    assert.equal(observations.find((o) => o.observationDate === "2026-04-02")?.value, 3.205);
  });

  it("drops a non-publication day instead of coercing it to zero", () => {
    const { observations, skipped, received } = normalize(valetFiveYearFixture);
    assert.equal(received, 5);
    assert.equal(observations.length, 4);
    assert.equal(skipped.length, 1);
    assert.deepEqual(skipped[0], { observationDate: "2026-04-03", reason: "empty-value" });
    // The critical assertion: Good Friday must not exist as a 0% observation.
    assert.equal(observations.some((o) => o.observationDate === "2026-04-03"), false);
    assert.equal(observations.some((o) => o.value === 0), false);
  });

  it("sorts ascending regardless of upstream order", () => {
    const { observations } = normalize({
      observations: [
        { d: "2026-04-07", "BD.CDN.5YR.DQ.YLD": { v: "3.21" } },
        { d: "2026-04-01", "BD.CDN.5YR.DQ.YLD": { v: "3.18" } },
      ],
    });
    assert.deepEqual(observations.map((o) => o.observationDate), ["2026-04-01", "2026-04-07"]);
  });

  it("flags a row that has no cell for the requested series", () => {
    const { observations, skipped } = normalize({
      observations: [{ d: "2026-04-01", "BD.CDN.10YR.DQ.YLD": { v: "3.5" } }],
    });
    assert.equal(observations.length, 0);
    assert.equal(skipped[0].reason, "missing-series");
  });

  it("flags an unparsable value rather than emitting NaN", () => {
    const { observations, skipped } = normalize({
      observations: [{ d: "2026-04-01", "BD.CDN.5YR.DQ.YLD": { v: "n/a" } }],
    });
    assert.equal(observations.length, 0);
    assert.equal(skipped[0].reason, "unparsable-value");
  });

  it("handles an empty observations array", () => {
    const { observations, received } = normalize({ observations: [] });
    assert.equal(observations.length, 0);
    assert.equal(received, 0);
  });
});

const observation = (over: Partial<BenchmarkObservation> = {}): BenchmarkObservation => ({
  seriesCode: "5y-canada-bond",
  observationDate: "2026-04-01",
  value: 3.18,
  source: "src-boc-valet",
  retrievedAt: RETRIEVED,
  dataQuality: "live",
  ...over,
});

describe("validateBenchmarkObservations", () => {
  it("accepts realistic yields", () => {
    const { valid, rejected } = validateBenchmarkObservations([
      observation({ observationDate: "2026-04-01", value: 3.18 }),
      observation({ observationDate: "2026-04-02", value: 0.42 }),  // 2020-era low
      observation({ observationDate: "2026-04-06", value: 12.5 }),  // 1980s-era high
    ]);
    assert.equal(valid.length, 3);
    assert.equal(rejected.length, 0);
  });

  it("rejects NaN and Infinity", () => {
    const { valid, rejected } = validateBenchmarkObservations([
      observation({ value: Number.NaN }),
      observation({ observationDate: "2026-04-02", value: Number.POSITIVE_INFINITY }),
    ]);
    assert.equal(valid.length, 0);
    assert.equal(rejected.length, 2);
  });

  it("rejects a missing value", () => {
    const bad = observation();
    delete (bad as Partial<BenchmarkObservation>).value;
    const { valid, rejected } = validateBenchmarkObservations([bad]);
    assert.equal(valid.length, 0);
    assert.match(rejected[0].message, /value/);
  });

  it("rejects impossible yields at both ends", () => {
    const { valid, rejected } = validateBenchmarkObservations([
      observation({ observationDate: "2026-04-01", value: -12 }),
      observation({ observationDate: "2026-04-02", value: 321 }),
    ]);
    assert.equal(valid.length, 0);
    assert.equal(rejected.length, 2);
  });

  it("rejects dates that are malformed or do not exist", () => {
    const { valid, rejected } = validateBenchmarkObservations([
      observation({ observationDate: "2026-02-31" }),
      observation({ observationDate: "15/06/2026" }),
      observation({ observationDate: "" }),
    ]);
    assert.equal(valid.length, 0);
    assert.equal(rejected.length, 3);
  });

  it("rejects an unknown series identifier", () => {
    const { valid, rejected } = validateBenchmarkObservations([
      observation({ seriesCode: "prime-rate" as BenchmarkObservation["seriesCode"] }),
    ]);
    assert.equal(valid.length, 0);
    assert.match(rejected[0].message, /seriesCode/);
  });

  it("rejects the second of two rows sharing an observation date", () => {
    const { valid, rejected } = validateBenchmarkObservations([
      observation({ observationDate: "2026-04-01", value: 3.18 }),
      observation({ observationDate: "2026-04-01", value: 3.99 }),
    ]);
    assert.equal(valid.length, 1);
    assert.equal(valid[0].value, 3.18);
    assert.match(rejected[0].message, /Duplicate observation/);
  });
});

describe("detectUnitAnomaly", () => {
  const batch = (value: number, n = 40) =>
    Array.from({ length: n }, (_unused, i) =>
      observation({ observationDate: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`, value }),
    );

  it("passes a normal batch", () => {
    assert.equal(detectUnitAnomaly(batch(3.2)), null);
  });

  it("catches a whole batch reported as fractions", () => {
    const message = detectUnitAnomaly(batch(0.032));
    assert.ok(message, "expected an anomaly message");
    assert.match(message!, /fractions instead of percent/);
  });

  it("catches a whole batch at the wrong scale upward", () => {
    assert.match(detectUnitAnomaly(batch(321))!, /scale error/);
  });

  it("stays quiet on a sample too small to judge", () => {
    assert.equal(detectUnitAnomaly(batch(0.032, 5)), null);
  });

  it("does not fire when only some values are low", () => {
    const mixed = [...batch(0.032, 20), ...batch(3.2, 20)];
    assert.equal(detectUnitAnomaly(mixed), null);
  });
});

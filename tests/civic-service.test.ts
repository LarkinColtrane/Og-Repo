import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assessPeriodFreshness, currentPeriod } from "@/lib/calculations/civic";
import { combineDataQuality } from "@/lib/api/response";
import { getPermitSeries } from "@/lib/data/civic-service";
import { resetCivicRepository, setCivicRepository } from "@/lib/data";
import { PostgresCivicDataRepository } from "@/lib/data/postgres-civic-repository";
import type { BoroughPermitStat } from "@/types/civic";
import { createFakeCivicDb } from "./fixtures/fake-civic-sql";

describe("assessPeriodFreshness", () => {
  const assess = (latestPeriod: string | null, today = "2026-08") =>
    assessPeriodFreshness({
      latestPeriod,
      maxPeriodLagMonths: 3,
      dataQuality: "live",
      today,
    });

  it("is live within the allowance", () => {
    assert.deepEqual(assess("2026-08"), { freshness: "live", monthLag: 0 });
    assert.deepEqual(assess("2026-05"), { freshness: "live", monthLag: 3 });
  });

  it("is stale beyond it", () => {
    assert.deepEqual(assess("2026-04"), { freshness: "stale", monthLag: 4 });
  });

  it("is unavailable with nothing on record", () => {
    assert.deepEqual(assess(null), { freshness: "unavailable", monthLag: null });
  });

  it("is demo for generated data, regardless of period", () => {
    // "Is this current?" does not apply to a number nobody published.
    assert.deepEqual(
      assessPeriodFreshness({
        latestPeriod: "2019-01",
        maxPeriodLagMonths: 3,
        dataQuality: "demo",
        today: "2026-08",
      }),
      { freshness: "demo", monthLag: null },
    );
  });

  it("treats a future period as stale rather than fresh", () => {
    // Not fresh — wrong. Reporting it as stale draws attention instead of
    // showing a green light over a broken date column.
    const result = assess("2027-01");
    assert.equal(result.freshness, "stale");
    assert.ok((result.monthLag ?? 0) < 0);
  });

  it("uses a much wider allowance than the daily benchmark rule", () => {
    // Municipal publication is irregular. A rule tuned to a daily series would
    // mark this stale most of the time, and an interface that says "stale" most
    // of the time has stopped saying anything.
    assert.equal(assess("2026-06").freshness, "live");
  });

  it("derives the current period in UTC", () => {
    assert.equal(currentPeriod(new Date("2026-03-15T23:30:00Z")), "2026-03");
  });
});

describe("combineDataQuality", () => {
  const dataset = (quality: "demo" | "live", name: string) => ({
    dataset: name,
    label: name,
    quality,
    sourceIds: [`src-${name}`],
  });

  it("is live only when every dataset is live", () => {
    assert.equal(combineDataQuality([dataset("live", "a"), dataset("live", "b")]), "live");
  });

  it("is demo when none is live", () => {
    assert.equal(combineDataQuality([dataset("demo", "a"), dataset("demo", "b")]), "demo");
  });

  it("is mixed when some are and some are not", () => {
    // The requirement, stated directly: one live dataset must never make the
    // rest of a response look verified.
    assert.equal(combineDataQuality([dataset("live", "a"), dataset("demo", "b")]), "mixed");
  });

  it("treats an empty list as demo, not live", () => {
    // Fails toward caution.
    assert.equal(combineDataQuality([]), "demo");
  });
});

describe("getPermitSeries", () => {
  afterEach(() => resetCivicRepository());

  const stat = (
    boroughCode: string,
    period: string,
    permitsIssued: number,
  ): BoroughPermitStat => ({
    boroughCode,
    period,
    permitsIssued,
    dwellingUnitsCreated: 4,
    declaredWorkValue: 500_000,
    byCategory: {
      "new-construction": 2,
      renovation: permitsIssued - 3,
      demolition: 1,
      other: 0,
    },
    dataSourceId: "src-montreal-permits",
    retrievedAt: "2026-08-26T12:00:00.000Z",
    dataQuality: "live",
  });

  async function withRows(rows: BoroughPermitStat[]) {
    const db = createFakeCivicDb(rows);
    setCivicRepository(new PostgresCivicDataRepository(db.executeSql));
  }

  it("returns borough statistics for a neighbourhood, with an attribution", async () => {
    await withRows([stat("le-sud-ouest", "2026-05", 60), stat("le-sud-ouest", "2026-06", 72)]);

    const series = await getPermitSeries({ neighbourhoodSlug: "griffintown" });

    assert.equal(series.boroughCode, "le-sud-ouest");
    assert.equal(series.observations.length, 2);
    assert.ok(series.attribution);
    assert.equal(series.attribution.coverage, "part-of");
  });

  it("labels a part-of figure with the BOROUGH name, never the neighbourhood", async () => {
    await withRows([stat("le-sud-ouest", "2026-05", 60)]);
    const series = await getPermitSeries({ neighbourhoodSlug: "griffintown" });

    assert.equal(series.attribution?.label, "Le Sud-Ouest");
    assert.ok(
      !series.attribution?.label.toLowerCase().includes("griffintown"),
      "the caption must not carry a neighbourhood name over a borough number",
    );
    assert.match(series.attribution?.note ?? "", /Saint-Henri/);
  });

  it("gives two neighbourhoods in one borough the same numbers and different notes", async () => {
    await withRows([stat("le-sud-ouest", "2026-05", 60)]);

    const griffintown = await getPermitSeries({ neighbourhoodSlug: "griffintown" });
    const saintHenri = await getPermitSeries({ neighbourhoodSlug: "saint-henri" });

    assert.deepEqual(griffintown.observations, saintHenri.observations, "one borough, one figure");
    assert.notEqual(griffintown.attribution?.note, saintHenri.attribution?.note);
    assert.match(griffintown.attribution?.note ?? "", /Saint-Henri/);
    assert.match(saintHenri.attribution?.note ?? "", /Griffintown/);
  });

  it("marks a coextensive neighbourhood as such", async () => {
    await withRows([stat("verdun", "2026-05", 30)]);
    const series = await getPermitSeries({ neighbourhoodSlug: "verdun" });
    assert.equal(series.attribution?.coverage, "coextensive");
    assert.match(series.attribution?.qualifier ?? "", /Borough-wide/);
  });

  it("calls Westmount a city, not a borough", async () => {
    await withRows([stat("westmount", "2026-05", 12)]);
    const series = await getPermitSeries({ neighbourhoodSlug: "westmount" });
    assert.match(series.attribution?.qualifier ?? "", /City-wide/);
  });

  it("returns no attribution when a borough is named directly", async () => {
    await withRows([stat("verdun", "2026-05", 30)]);
    const series = await getPermitSeries({ boroughCode: "verdun" });
    assert.equal(series.attribution, null, "no neighbourhood was named, so there is no caveat");
  });

  it("always includes the city roll-up as a denominator", async () => {
    await withRows([
      stat("verdun", "2026-05", 30),
      stat("outremont", "2026-05", 10),
      stat("anjou", "2026-05", 20),
    ]);

    const series = await getPermitSeries({ boroughCode: "verdun" });
    assert.equal(series.observations.length, 1);
    assert.equal(series.city.length, 1);
    assert.equal(series.city[0].permitsIssued, 60, "every borough, not just the one asked for");
    assert.equal(series.city[0].boroughsReporting, 3);
  });

  it("takes provenance from the rows rather than assuming it", async () => {
    await withRows([stat("verdun", "2026-05", 30)]);
    const series = await getPermitSeries({ boroughCode: "verdun" });
    assert.deepEqual(
      series.sources.map((s) => s.sourceId),
      ["src-montreal-permits"],
    );
  });

  it("anchors the window to the latest period on record, not to today", async () => {
    // Anchoring to today would shrink the visible range whenever the data was
    // behind — exactly when a reader most wants the whole picture.
    await withRows([
      stat("verdun", "2025-01", 10),
      stat("verdun", "2025-02", 12),
      stat("verdun", "2025-03", 14),
    ]);

    const series = await getPermitSeries({ boroughCode: "verdun", months: 3 });
    assert.equal(series.latestPeriod, "2025-03");
    assert.equal(series.observations.length, 3);
  });

  it("returns nothing, not an error, for a borough with no rows", async () => {
    await withRows([stat("verdun", "2026-05", 30)]);
    const series = await getPermitSeries({ boroughCode: "anjou" });
    assert.deepEqual(series.observations, []);
  });

  it("falls back to the demo repository by default, labelled demo", async () => {
    const series = await getPermitSeries({ neighbourhoodSlug: "verdun" });
    assert.equal(series.dataQuality, "demo");
    for (const source of series.sources) {
      assert.equal(source.isDemo, true);
      assert.notEqual(
        source.sourceId,
        "src-montreal-permits",
        "generated numbers are never credited to the city",
      );
    }
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMontrealPermits,
  parseIssuedPeriod,
  readNumber,
} from "@/lib/pipeline/transforms/montreal-permits";
import {
  MONTREAL_PERMITS,
  resolveFields,
} from "@/lib/pipeline/connectors/montreal-open-data/datasets";
import {
  detectPermitBatchAnomaly,
  validatePermitStats,
} from "@/lib/pipeline/validate";
import { PERMIT_FIELDS, permitRow } from "./fixtures/ckan";

const fields = resolveFields(MONTREAL_PERMITS, PERMIT_FIELDS);
const RETRIEVED_AT = "2026-08-26T12:00:00.000Z";

const normalize = (
  records: Array<Record<string, unknown>>,
  options: { from?: string; to?: string } = {},
) =>
  normalizeMontrealPermits(records, {
    dataset: MONTREAL_PERMITS,
    fields,
    retrievedAt: RETRIEVED_AT,
    ...options,
  });

describe("readNumber", () => {
  it("passes a real number through", () => {
    assert.equal(readNumber(1234.5), 1234.5);
  });

  it("returns null for empty, not zero", () => {
    // `Number("")` is 0. That is how an empty cell becomes a confident zero in
    // every naive importer ever written.
    assert.equal(readNumber(""), null);
    assert.equal(readNumber("   "), null);
    assert.equal(readNumber(null), null);
    assert.equal(readNumber(undefined), null);
  });

  it("returns null for non-numeric text", () => {
    assert.equal(readNumber("n/a"), null);
    assert.equal(readNumber("sans objet"), null);
  });

  it("rejects NaN and Infinity", () => {
    assert.equal(readNumber(NaN), null);
    assert.equal(readNumber(Infinity), null);
  });

  it("reads a French-Canadian decimal comma", () => {
    assert.equal(readNumber("1234,5"), 1234.5);
    assert.equal(readNumber("85 000,00"), 85000);
  });

  it("reads an English thousands comma", () => {
    assert.equal(readNumber("1,234"), 1234);
    assert.equal(readNumber("1,234.56"), 1234.56);
  });

  it("reads a mixed European format", () => {
    assert.equal(readNumber("1.234,56"), 1234.56);
  });

  it("strips a currency symbol", () => {
    assert.equal(readNumber("$85,000"), 85000);
  });
});

describe("parseIssuedPeriod", () => {
  it("accepts ISO dates with and without a time", () => {
    assert.deepEqual(parseIssuedPeriod("2026-05-14"), { ok: true, period: "2026-05" });
    assert.deepEqual(parseIssuedPeriod("2026-05-14T09:30:00"), { ok: true, period: "2026-05" });
    assert.deepEqual(parseIssuedPeriod("2026-05"), { ok: true, period: "2026-05" });
  });

  it("accepts YYYY/MM/DD", () => {
    assert.deepEqual(parseIssuedPeriod("2026/05/14"), { ok: true, period: "2026-05" });
  });

  it("REJECTS an ambiguous day/month slash date rather than guessing", () => {
    // 03/04/2026 is 3 April in Québec and 4 March in the US. Both readings give
    // a *different reporting month*, and everything here is bucketed by month —
    // so a wrong guess does not shift a statistic slightly, it files it under
    // the wrong period.
    const parsed = parseIssuedPeriod("03/04/2026");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "ambiguous-date");
    assert.match(parsed.ok === false ? parsed.message : "", /day\/month or month\/day/);
  });

  it("accepts a slash date whose first component can only be a day", () => {
    assert.deepEqual(parseIssuedPeriod("25/12/2026"), { ok: true, period: "2026-12" });
  });

  it("rejects an impossible month", () => {
    const parsed = parseIssuedPeriod("2026-13-01");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.reason, "unparseable-date");
  });

  it("rejects text that is not a date", () => {
    assert.equal(parseIssuedPeriod("sans date").ok, false);
    assert.equal(parseIssuedPeriod("").ok, false);
  });
});

describe("normalizeMontrealPermits", () => {
  it("aggregates rows into borough-month totals", () => {
    const result = normalize([
      permitRow({ borough: "Verdun", date: "2026-05-04" }, 1),
      permitRow({ borough: "Verdun", date: "2026-05-20" }, 2),
      permitRow({ borough: "Verdun", date: "2026-06-02" }, 3),
    ]);

    assert.equal(result.stats.length, 2, "two months, not three permits");
    assert.equal(result.stats[0].period, "2026-05");
    assert.equal(result.stats[0].permitsIssued, 2);
    assert.equal(result.stats[1].period, "2026-06");
    assert.equal(result.stats[1].permitsIssued, 1);
  });

  it("keys on the normalized borough code, not the published spelling", () => {
    const result = normalize([
      permitRow({ borough: "Le Sud-Ouest", date: "2026-05-04" }, 1),
      permitRow({ borough: "LE SUD-OUEST", date: "2026-05-05" }, 2),
      permitRow({ borough: "Arrondissement du Sud-Ouest", date: "2026-05-06" }, 3),
    ]);

    assert.equal(result.stats.length, 1, "three spellings are one borough");
    assert.equal(result.stats[0].boroughCode, "le-sud-ouest");
    assert.equal(result.stats[0].permitsIssued, 3);
  });

  it("rejects an unknown borough and names it, rather than guessing", () => {
    const result = normalize([
      permitRow({ borough: "Verdun", date: "2026-05-04" }, 1),
      permitRow({ borough: "Laval", date: "2026-05-05" }, 2),
    ]);

    assert.equal(result.stats.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].reason, "unknown-borough");
    assert.deepEqual(result.unknownBoroughs, ["Laval"]);
    assert.match(result.rejected[0].message, /MONTREAL_MUNICIPALITIES/);
  });

  it("rejects a row with no borough and one with no date", () => {
    const result = normalize([
      { ...permitRow({}, 1), arrondissement: "" },
      { ...permitRow({}, 2), date_emission: null },
    ]);
    assert.equal(result.stats.length, 0);
    assert.deepEqual(
      result.rejected.map((r) => r.reason).sort(),
      ["missing-borough", "missing-date"],
    );
  });

  it("counts categories so they sum to the permit total", () => {
    const result = normalize([
      permitRow({ date: "2026-05-01", nature: "Nouvelle construction" }, 1),
      permitRow({ date: "2026-05-02", nature: "Rénovation intérieure" }, 2),
      permitRow({ date: "2026-05-03", nature: "Démolition" }, 3),
      permitRow({ date: "2026-05-04", nature: "Certificat d'occupation" }, 4),
    ]);

    const stat = result.stats[0];
    assert.deepEqual(stat.byCategory, {
      "new-construction": 1,
      renovation: 1,
      demolition: 1,
      other: 1,
    });
    const sum = Object.values(stat.byCategory).reduce((a, b) => a + b, 0);
    assert.equal(sum, stat.permitsIssued);
  });

  it("distinguishes 'no value reported' from zero", () => {
    const withNone = normalize([
      { ...permitRow({ date: "2026-05-01" }, 1), nombre_logements: "", valeur_travaux: "" },
    ]);
    assert.equal(withNone.stats[0].dwellingUnitsCreated, null, "null, not 0");
    assert.equal(withNone.stats[0].declaredWorkValue, null);

    const withZero = normalize([
      { ...permitRow({ date: "2026-05-01" }, 1), nombre_logements: 0, valeur_travaux: 0 },
    ]);
    assert.equal(withZero.stats[0].dwellingUnitsCreated, 0, "0 means zero declared");
    assert.equal(withZero.stats[0].declaredWorkValue, 0);
  });

  it("sums the values that are present when only some rows carry them", () => {
    const result = normalize([
      { ...permitRow({ date: "2026-05-01" }, 1), nombre_logements: 4 },
      { ...permitRow({ date: "2026-05-02" }, 2), nombre_logements: "" },
      { ...permitRow({ date: "2026-05-03" }, 3), nombre_logements: 2 },
    ]);
    assert.equal(result.stats[0].dwellingUnitsCreated, 6);
    assert.equal(result.stats[0].permitsIssued, 3);
  });

  it("applies a period window without counting the excluded rows as rejected", () => {
    const result = normalize(
      [
        permitRow({ date: "2025-01-15" }, 1),
        permitRow({ date: "2026-05-15" }, 2),
        permitRow({ date: "2026-06-15" }, 3),
      ],
      { from: "2026-05", to: "2026-05" },
    );
    assert.equal(result.stats.length, 1);
    assert.equal(result.stats[0].period, "2026-05");
    assert.equal(result.rejected.length, 0, "out of range is not a rejection");
  });

  it("is deterministic — the same input gives byte-identical output", () => {
    const records = [permitRow({ date: "2026-05-04" }, 1), permitRow({ date: "2026-05-05" }, 2)];
    assert.equal(
      JSON.stringify(normalize(records).stats),
      JSON.stringify(normalize(records).stats),
    );
  });

  it("stamps the injected retrievedAt and the real source id", () => {
    const stat = normalize([permitRow({ date: "2026-05-04" }, 1)]).stats[0];
    assert.equal(stat.retrievedAt, RETRIEVED_AT);
    assert.equal(stat.dataSourceId, "src-montreal-permits");
    assert.equal(stat.dataQuality, "live");
  });

  it("returns rows sorted by period then borough", () => {
    const result = normalize([
      permitRow({ borough: "Verdun", date: "2026-06-01" }, 1),
      permitRow({ borough: "Outremont", date: "2026-05-01" }, 2),
      permitRow({ borough: "Anjou", date: "2026-05-01" }, 3),
    ]);
    assert.deepEqual(
      result.stats.map((s) => `${s.period}:${s.boroughCode}`),
      ["2026-05:anjou", "2026-05:outremont", "2026-06:verdun"],
    );
  });
});

describe("validatePermitStats", () => {
  const good = () => normalize([permitRow({ date: "2026-05-04" }, 1)]).stats[0];

  it("accepts a well-formed row", () => {
    const { valid, rejected } = validatePermitStats([good()]);
    assert.equal(valid.length, 1);
    assert.deepEqual(rejected, []);
  });

  it("rejects an unknown borough code", () => {
    const { valid, rejected } = validatePermitStats([{ ...good(), boroughCode: "laval" }]);
    assert.equal(valid.length, 0);
    assert.match(rejected[0].message, /municipality registry/);
  });

  it("rejects a malformed period", () => {
    const { rejected } = validatePermitStats([{ ...good(), period: "2026-13" }]);
    assert.match(rejected[0].message, /YYYY-MM/);
  });

  it("rejects an implausible permit count", () => {
    const { rejected } = validatePermitStats([
      { ...good(), permitsIssued: 99_999, byCategory: { "new-construction": 99_999, renovation: 0, demolition: 0, other: 0 } },
    ]);
    assert.match(rejected[0].message, /not a real figure/);
  });

  it("rejects a breakdown that does not add up", () => {
    // Worse than no breakdown, because it looks authoritative.
    const { rejected } = validatePermitStats([
      {
        ...good(),
        permitsIssued: 10,
        byCategory: { "new-construction": 1, renovation: 1, demolition: 0, other: 0 },
      },
    ]);
    assert.match(rejected[0].message, /does not add up/);
  });

  it("rejects a duplicate (borough, period) within one batch", () => {
    // It is the upsert key: two rows would make the write order decide the
    // stored value.
    const { valid, rejected } = validatePermitStats([good(), good()]);
    assert.equal(valid.length, 1);
    assert.match(rejected[0].message, /Duplicate row/);
  });

  it("accepts null unit and value counts", () => {
    const { valid } = validatePermitStats([
      { ...good(), dwellingUnitsCreated: null, declaredWorkValue: null },
    ]);
    assert.equal(valid.length, 1);
  });

  it("rejects a negative count", () => {
    const { rejected } = validatePermitStats([{ ...good(), permitsIssued: -1 }]);
    assert.equal(rejected.length, 1);
  });
});

describe("detectPermitBatchAnomaly", () => {
  const stat = (period: string, permits = 5) => ({
    ...normalize([permitRow({ date: "2026-05-04" }, 1)]).stats[0],
    period,
    permitsIssued: permits,
    byCategory: { "new-construction": permits, renovation: 0, demolition: 0, other: 0 },
  });

  it("passes a normal batch", () => {
    assert.equal(
      detectPermitBatchAnomaly([stat("2026-05"), stat("2026-06")], { today: "2026-08" }),
      null,
    );
  });

  it("refuses a batch containing future periods", () => {
    // The signature of a misread date column.
    const message = detectPermitBatchAnomaly([stat("2026-05"), stat("2031-02")], {
      today: "2026-08",
    });
    assert.match(message ?? "", /cannot be issued in the future/);
    assert.match(message ?? "", /2031-02/);
    assert.match(message ?? "", /Nothing was written/);
  });

  it("allows one month of slack for publication lag", () => {
    assert.equal(detectPermitBatchAnomaly([stat("2026-09")], { today: "2026-08" }), null);
    assert.ok(detectPermitBatchAnomaly([stat("2026-10")], { today: "2026-08" }));
  });

  it("refuses a batch of rows totalling zero permits", () => {
    const message = detectPermitBatchAnomaly([stat("2026-05", 0)], { today: "2026-08" });
    assert.match(message ?? "", /empty extract/);
  });

  it("passes an empty batch through — that is the ingest service's call", () => {
    assert.equal(detectPermitBatchAnomaly([], { today: "2026-08" }), null);
  });
});

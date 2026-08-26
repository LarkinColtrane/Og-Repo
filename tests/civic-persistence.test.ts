import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PostgresCivicDataRepository } from "@/lib/data/postgres-civic-repository";
import { DemoCivicDataRepository } from "@/lib/data/demo-civic-repository";
import {
  CivicWriteNotSupportedError,
  summarisePermitsByPeriod,
} from "@/lib/data/civic-repository";
import type { BoroughPermitStat } from "@/types/civic";
import { createFakeCivicDb } from "./fixtures/fake-civic-sql";

const stat = (
  boroughCode: string,
  period: string,
  overrides: Partial<BoroughPermitStat> = {},
): BoroughPermitStat => ({
  boroughCode,
  period,
  permitsIssued: 100,
  dwellingUnitsCreated: 12,
  declaredWorkValue: 4_500_000,
  byCategory: { "new-construction": 8, renovation: 85, demolition: 3, other: 4 },
  dataSourceId: "src-montreal-permits",
  retrievedAt: "2026-08-26T12:00:00.000Z",
  dataQuality: "live",
  ...overrides,
});

describe("PostgresCivicDataRepository", () => {
  it("inserts new rows", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);

    const written = await repo.upsertPermitStats([
      stat("verdun", "2026-05"),
      stat("verdun", "2026-06"),
    ]);

    assert.equal(written, 2);
    assert.equal(db.rows.size, 2);
  });

  it("upserts on (borough, period) — the same import twice is idempotent", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    const batch = [stat("verdun", "2026-05"), stat("outremont", "2026-05")];

    await repo.upsertPermitStats(batch);
    await repo.upsertPermitStats(batch);

    assert.equal(db.rows.size, 2, "re-running an import does not double the rows");
  });

  it("replaces a revised month in place", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);

    await repo.upsertPermitStats([stat("verdun", "2026-05", { permitsIssued: 90 })]);
    await repo.upsertPermitStats([stat("verdun", "2026-05", { permitsIssued: 104 })]);

    assert.equal(db.rows.size, 1);
    assert.equal(db.rows.get("verdun:2026-05")?.permitsIssued, 104);
  });

  it("writes nothing for an empty batch, without issuing a statement", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    assert.equal(await repo.upsertPermitStats([]), 0);
    assert.equal(db.queries.length, 0);
  });

  it("reads back a range, ascending", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    await repo.upsertPermitStats([
      stat("verdun", "2026-06"),
      stat("verdun", "2026-04"),
      stat("verdun", "2026-05"),
    ]);

    const rows = await repo.getPermitStats({ boroughCode: "verdun", from: "2026-04", to: "2026-06" });
    assert.deepEqual(rows.map((r) => r.period), ["2026-04", "2026-05", "2026-06"]);
  });

  it("a limit returns the most recent periods, not the oldest", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    await repo.upsertPermitStats([
      stat("verdun", "2026-01"),
      stat("verdun", "2026-02"),
      stat("verdun", "2026-03"),
    ]);

    const rows = await repo.getPermitStats({ boroughCode: "verdun", limit: 2 });
    assert.deepEqual(rows.map((r) => r.period), ["2026-02", "2026-03"]);
  });

  it("converts numeric columns that the driver returns as strings", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    await repo.upsertPermitStats([stat("verdun", "2026-05")]);

    const [row] = await repo.getPermitStats({ boroughCode: "verdun" });
    assert.equal(typeof row.declaredWorkValue, "number");
    assert.equal(row.declaredWorkValue, 4_500_000);
  });

  it("preserves a null unit count through a round trip", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    await repo.upsertPermitStats([
      stat("verdun", "2026-05", { dwellingUnitsCreated: null, declaredWorkValue: null }),
    ]);

    const [row] = await repo.getPermitStats({ boroughCode: "verdun" });
    assert.equal(row.dwellingUnitsCreated, null, "null must not become 0 on the way back");
    assert.equal(row.declaredWorkValue, null);
  });

  it("reports the latest period and the reporting boroughs", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    await repo.upsertPermitStats([stat("verdun", "2026-05"), stat("anjou", "2026-07")]);

    assert.equal(await repo.getLatestPeriod(), "2026-07");
    assert.deepEqual(await repo.getReportingBoroughs(), ["anjou", "verdun"]);
  });

  it("surfaces a write failure rather than swallowing it", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);
    db.failNext("deadlock detected");

    await assert.rejects(() => repo.upsertPermitStats([stat("verdun", "2026-05")]), /deadlock/);
  });

  /**
   * The property the whole storage design turns on.
   *
   * A month the extract does not mention must be left alone. "The publisher's
   * file did not include Verdun" is not evidence that Verdun issued no permits —
   * it is far more likely to mean the extract was filtered, truncated or broken.
   * A pipeline that deletes on absence turns one bad import into lost history.
   */
  it("NEVER removes a row that a later import does not mention", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);

    // A good import covering three boroughs.
    await repo.upsertPermitStats([
      stat("verdun", "2026-05", { permitsIssued: 90 }),
      stat("outremont", "2026-05", { permitsIssued: 40 }),
      stat("anjou", "2026-05", { permitsIssued: 55 }),
    ]);
    assert.equal(db.rows.size, 3);

    // A later, narrower import mentioning only one of them.
    await repo.upsertPermitStats([stat("verdun", "2026-05", { permitsIssued: 92 })]);

    assert.equal(db.rows.size, 3, "the unmentioned boroughs are still there");
    assert.equal(db.rows.get("verdun:2026-05")?.permitsIssued, 92, "the mentioned one updated");
    assert.equal(db.rows.get("outremont:2026-05")?.permitsIssued, 40, "untouched");
    assert.equal(db.rows.get("anjou:2026-05")?.permitsIssued, 55, "untouched");
    assert.equal(db.deleteCalls, 0, "no DELETE was ever issued");
  });

  it("leaves earlier months untouched when a recent month is re-imported", async () => {
    const db = createFakeCivicDb();
    const repo = new PostgresCivicDataRepository(db.executeSql);

    await repo.upsertPermitStats([
      stat("verdun", "2024-01"),
      stat("verdun", "2025-01"),
      stat("verdun", "2026-05"),
    ]);
    await repo.upsertPermitStats([stat("verdun", "2026-06")]);

    assert.equal(db.rows.size, 4);
    assert.ok(db.rows.has("verdun:2024-01"), "two-year-old history survives");
  });
});

describe("DemoCivicDataRepository", () => {
  it("serves generated statistics labelled demo", async () => {
    const repo = new DemoCivicDataRepository();
    const rows = await repo.getPermitStats({ boroughCode: "verdun" });

    assert.ok(rows.length > 0);
    assert.equal(repo.dataQuality, "demo");
    for (const row of rows) {
      assert.equal(row.dataQuality, "demo");
      assert.equal(
        row.dataSourceId,
        "src-demo-permits",
        "generated data must never be attributed to the Ville de Montréal",
      );
    }
  });

  it("generates category counts that sum to the permit total", async () => {
    // Generated data that could not pass its own validator would be a poor
    // stand-in for real data.
    const rows = await new DemoCivicDataRepository().getPermitStats({});
    for (const row of rows) {
      const sum = Object.values(row.byCategory).reduce((a, b) => a + b, 0);
      assert.equal(sum, row.permitsIssued, `${row.boroughCode} ${row.period}`);
    }
  });

  it("refuses writes loudly rather than accepting them into memory", async () => {
    await assert.rejects(
      () => new DemoCivicDataRepository().upsertPermitStats([stat("verdun", "2026-05")]),
      CivicWriteNotSupportedError,
    );
  });

  it("covers every registered municipality", async () => {
    const boroughs = await new DemoCivicDataRepository().getReportingBoroughs();
    assert.equal(boroughs.length, 20, "19 boroughs plus Westmount");
  });
});

describe("summarisePermitsByPeriod", () => {
  it("sums boroughs into city-month totals", () => {
    const summary = summarisePermitsByPeriod([
      stat("verdun", "2026-05", { permitsIssued: 90 }),
      stat("anjou", "2026-05", { permitsIssued: 55 }),
      stat("verdun", "2026-06", { permitsIssued: 100 }),
    ]);

    assert.equal(summary.length, 2);
    assert.equal(summary[0].period, "2026-05");
    assert.equal(summary[0].permitsIssued, 145);
    assert.equal(summary[0].boroughsReporting, 2);
  });

  it("keeps a city total null when no borough reported a count", () => {
    // Summing null as zero would publish a confident under-count.
    const summary = summarisePermitsByPeriod([
      stat("verdun", "2026-05", { dwellingUnitsCreated: null }),
      stat("anjou", "2026-05", { dwellingUnitsCreated: null }),
    ]);
    assert.equal(summary[0].dwellingUnitsCreated, null);
  });

  it("sums the boroughs that did report when some did not", () => {
    const summary = summarisePermitsByPeriod([
      stat("verdun", "2026-05", { dwellingUnitsCreated: 12 }),
      stat("anjou", "2026-05", { dwellingUnitsCreated: null }),
    ]);
    assert.equal(summary[0].dwellingUnitsCreated, 12);
  });

  it("marks the city total demo if any borough in it is demo", () => {
    // A total is only as trustworthy as its least reliable input.
    const summary = summarisePermitsByPeriod([
      stat("verdun", "2026-05", { dataQuality: "live" }),
      stat("anjou", "2026-05", { dataQuality: "demo" }),
    ]);
    assert.equal(summary[0].dataQuality, "demo");
  });

  it("sums category counts across boroughs", () => {
    const summary = summarisePermitsByPeriod([
      stat("verdun", "2026-05"),
      stat("anjou", "2026-05"),
    ]);
    assert.equal(summary[0].byCategory.renovation, 170);
    assert.equal(summary[0].byCategory["new-construction"], 16);
  });
});

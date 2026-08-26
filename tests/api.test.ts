import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

/**
 * HTTP-level tests against a running production build.
 *
 * These exercise routing, query validation and the response envelope — things a
 * unit test cannot reach. They are skipped when no server is listening, so the
 * suite still runs in isolation; `API_BASE_URL` points them at one.
 */
const BASE = process.env.API_BASE_URL ?? "http://localhost:3140";

let serverUp = false;

before(async () => {
  try {
    const response = await fetch(`${BASE}/api/market/benchmarks`, {
      signal: AbortSignal.timeout(3000),
    });
    serverUp = response.ok;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log(`# API tests skipped — no server at ${BASE}`);
  }
});

const api = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, init);

describe("GET /api/market/benchmarks", () => {
  it("returns a snapshot with the standard envelope", async (t) => {
    if (!serverUp) return t.skip("no server");
    const response = await api("/api/market/benchmarks?series=5y-canada-bond&range=1y");
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(body.data, "payload under `data`");
    assert.ok(body.meta, "metadata under `meta`");
    assert.ok(["demo", "live"].includes(body.meta.dataQuality));
    assert.ok(Array.isArray(body.meta.sources));

    const { snapshot, observations, range } = body.data;
    assert.equal(range, "1y");
    assert.equal(snapshot.series.code, "5y-canada-bond");
    assert.equal(snapshot.series.upstreamCode, "BD.CDN.5YR.DQ.YLD");
    assert.ok(snapshot.latest, "a latest observation");
    assert.ok(observations.length > 0);
  });

  it("defaults series and range when omitted", async (t) => {
    if (!serverUp) return t.skip("no server");
    const body = await (await api("/api/market/benchmarks")).json();
    assert.equal(body.data.range, "1y");
    assert.equal(body.data.snapshot.series.code, "5y-canada-bond");
  });

  it("returns more observations for a longer range", async (t) => {
    if (!serverUp) return t.skip("no server");
    const short = await (await api("/api/market/benchmarks?range=3m")).json();
    const long = await (await api("/api/market/benchmarks?range=5y")).json();
    assert.ok(
      long.data.observations.length > short.data.observations.length * 3,
      `5y (${long.data.observations.length}) should dwarf 3m (${short.data.observations.length})`,
    );
  });

  it("never returns a weekend observation", async (t) => {
    if (!serverUp) return t.skip("no server");
    const body = await (await api("/api/market/benchmarks?range=1y")).json();
    const weekend = body.data.observations.filter((o: { observationDate: string }) => {
      const day = new Date(`${o.observationDate}T00:00:00Z`).getUTCDay();
      return day === 0 || day === 6;
    });
    assert.equal(weekend.length, 0);
  });

  it("rejects an unknown series with a 400", async (t) => {
    if (!serverUp) return t.skip("no server");
    const response = await api("/api/market/benchmarks?series=nasdaq");
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "INVALID_REQUEST");
  });

  it("rejects an unknown range with a 400", async (t) => {
    if (!serverUp) return t.skip("no server");
    assert.equal((await api("/api/market/benchmarks?range=42y")).status, 400);
  });
});

describe("POST /api/internal/market-data/bank-of-canada", () => {
  const post = (body: unknown) =>
    api("/api/internal/market-data/bank-of-canada", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rejects a non-JSON body", async (t) => {
    if (!serverUp) return t.skip("no server");
    const response = await api("/api/internal/market-data/bank-of-canada", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    assert.equal(response.status, 400);
  });

  it("rejects an unknown series", async (t) => {
    if (!serverUp) return t.skip("no server");
    const response = await post({ series: "nasdaq" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /series/);
  });

  it("rejects an impossible date", async (t) => {
    if (!serverUp) return t.skip("no server");
    const response = await post({ startDate: "2026-02-31", endDate: "2026-03-01" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /does not exist/);
  });

  it("rejects a reversed date range", async (t) => {
    if (!serverUp) return t.skip("no server");
    const response = await post({ startDate: "2026-06-01", endDate: "2026-01-01" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /must not be after/);
  });

  it("rejects a range and `recent` together", async (t) => {
    if (!serverUp) return t.skip("no server");
    const response = await post({ startDate: "2026-01-01", recent: 10 });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /not both/);
  });

  it("reports an upstream failure without leaking a stack trace", async (t) => {
    if (!serverUp) return t.skip("no server");
    // This host is blocked by the sandbox egress policy, so the request fails —
    // which is exactly the path being tested: a clean, reported failure.
    const response = await post({ series: "5y-canada-bond", recent: 5 });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(body.error.details.runId, "the failed run is identified");
    assert.ok(body.error.details.errorKind, "the failure is classified");
    assert.equal(body.error.details.recordsWritten, 0);
    assert.ok(body.error.details.requestUrl.startsWith("https://www.bankofcanada.ca/valet/"));
    assert.ok(!JSON.stringify(body).includes("    at "), "no stack frames in the response");
  });
});

describe("GET /api/internal/market-data/status", () => {
  it("reports store, series freshness and import health", async (t) => {
    if (!serverUp) return t.skip("no server");
    const body = await (await api("/api/internal/market-data/status")).json();

    assert.ok(body.data.store.benchmarks);
    assert.equal(typeof body.data.store.ephemeral, "boolean");
    assert.ok(Array.isArray(body.data.series));
    assert.ok(body.data.series.some((s: { seriesCode: string }) => s.seriesCode === "5y-canada-bond"));
    assert.ok(body.data.health);
    assert.equal(typeof body.data.health.consecutiveFailures, "number");
    assert.equal(body.data.authentication.enabled, false, "the auth gap is declared, not hidden");
  });
});

describe("existing endpoints still work", () => {
  const routes = [
    "/api/market/montreal",
    "/api/neighbourhoods",
    "/api/neighbourhoods/verdun",
    "/api/neighbourhoods/verdun/rent?range=1y",
    "/api/neighbourhoods/verdun/sales?propertyType=condo&range=3y",
    "/api/compare?slugs=verdun,villeray",
    "/api/data-sources",
    "/api/mortgage/lenders",
    "/api/mortgage/rates?productType=fixed&termYears=5",
    "/api/mortgage/compare?price=725000&downPaymentPercent=20",
  ];

  for (const route of routes) {
    it(`200s: ${route}`, async (t) => {
      if (!serverUp) return t.skip("no server");
      assert.equal((await api(route)).status, 200, route);
    });
  }
});

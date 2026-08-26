import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BankOfCanadaConnector,
  BankOfCanadaError,
} from "@/lib/pipeline/connectors/bank-of-canada/client";
import { jsonResponse, valetFiveYearFixture, valetMalformedFixture } from "./fixtures/valet";

describe("BankOfCanadaConnector", () => {
  it("builds the documented observations URL for a date range", () => {
    const connector = new BankOfCanadaConnector();
    const url = connector.buildUrl({
      upstreamCode: "BD.CDN.5YR.DQ.YLD",
      startDate: "2021-01-01",
      endDate: "2026-06-30",
    });
    assert.equal(
      url,
      "https://www.bankofcanada.ca/valet/observations/BD.CDN.5YR.DQ.YLD/json" +
        "?start_date=2021-01-01&end_date=2026-06-30",
    );
  });

  it("uses `recent` instead of a range when asked", () => {
    const connector = new BankOfCanadaConnector();
    const url = connector.buildUrl({ upstreamCode: "BD.CDN.5YR.DQ.YLD", recent: 5 });
    assert.ok(url.endsWith("/json?recent=5"), url);
  });

  it("returns the parsed body on success", async () => {
    const connector = new BankOfCanadaConnector({
      fetchImpl: async () => jsonResponse(valetFiveYearFixture),
    });
    const result = await connector.fetchObservations({
      upstreamCode: "BD.CDN.5YR.DQ.YLD",
      recent: 5,
    });
    assert.equal(result.observations?.length, 5);
    assert.equal(result.observations?.[0].d, "2026-04-01");
  });

  it("classifies a network failure rather than leaking the raw error", async () => {
    const connector = new BankOfCanadaConnector({
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await assert.rejects(
      () => connector.fetchObservations({ upstreamCode: "X", recent: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BankOfCanadaError);
        assert.equal(error.kind, "network");
        assert.match(error.message, /Could not reach the Bank of Canada/);
        return true;
      },
    );
  });

  it("classifies a timeout separately from a network failure", async () => {
    const connector = new BankOfCanadaConnector({
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    await assert.rejects(
      () => connector.fetchObservations({ upstreamCode: "X", recent: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BankOfCanadaError);
        assert.equal(error.kind, "timeout");
        return true;
      },
    );
  });

  it("surfaces the API's own message on a 4xx", async () => {
    const connector = new BankOfCanadaConnector({
      fetchImpl: async () => jsonResponse({ message: "Series not found" }, 404),
    });
    await assert.rejects(
      () => connector.fetchObservations({ upstreamCode: "NOPE", recent: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BankOfCanadaError);
        assert.equal(error.kind, "http");
        assert.equal(error.status, 404);
        assert.match(error.message, /Series not found/);
        return true;
      },
    );
  });

  it("refuses a 200 that is not an observations response", async () => {
    const connector = new BankOfCanadaConnector({
      fetchImpl: async () => jsonResponse(valetMalformedFixture),
    });
    await assert.rejects(
      () => connector.fetchObservations({ upstreamCode: "X", recent: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BankOfCanadaError);
        assert.equal(error.kind, "malformed");
        assert.match(error.message, /no "observations" array/);
        return true;
      },
    );
  });

  it("refuses a 200 that is not JSON at all", async () => {
    const connector = new BankOfCanadaConnector({
      fetchImpl: async () =>
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    await assert.rejects(
      () => connector.fetchObservations({ upstreamCode: "X", recent: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BankOfCanadaError);
        assert.equal(error.kind, "malformed");
        return true;
      },
    );
  });
});

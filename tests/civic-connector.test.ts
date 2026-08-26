import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MontrealOpenDataConnector,
  MontrealOpenDataError,
} from "@/lib/pipeline/connectors/montreal-open-data/client";
import {
  MONTREAL_PERMITS,
  classifyPermitCategory,
  foldColumnName,
  describeSchemaMismatch,
  resolveFields,
} from "@/lib/pipeline/connectors/montreal-open-data/datasets";
import {
  PERMIT_FIELDS,
  createCkanFetch,
  packageResponse,
  permitRow,
} from "./fixtures/ckan";

const connector = (fetchImpl: typeof fetch, options = {}) =>
  new MontrealOpenDataConnector({ fetchImpl, baseUrl: "https://portal.test/api/3/action", ...options });

describe("MontrealOpenDataConnector — URLs", () => {
  it("builds a datastore URL with limit, offset and filters", () => {
    const client = connector(createCkanFetch({}).fetchImpl);
    const url = new URL(
      client.buildDatastoreUrl(
        { resourceId: "res-1", filters: { arrondissement: "Verdun" } },
        200,
        50,
      ),
    );
    assert.equal(url.pathname, "/api/3/action/datastore_search");
    assert.equal(url.searchParams.get("resource_id"), "res-1");
    assert.equal(url.searchParams.get("limit"), "50");
    assert.equal(url.searchParams.get("offset"), "200");
    assert.deepEqual(JSON.parse(url.searchParams.get("filters") ?? "{}"), {
      arrondissement: "Verdun",
    });
  });

  it("builds a package URL from the dataset slug", () => {
    const client = connector(createCkanFetch({}).fetchImpl);
    const url = new URL(client.buildPackageUrl("permis-construction"));
    assert.equal(url.searchParams.get("id"), "permis-construction");
  });
});

describe("MontrealOpenDataConnector — reading", () => {
  it("returns dataset metadata", async () => {
    const { fetchImpl } = createCkanFetch({});
    const pkg = await connector(fetchImpl).fetchPackage("permis-construction");
    assert.equal(pkg.name, "permis-construction");
    assert.equal(pkg.license_title, "Creative Commons Attribution 4.0");
    assert.equal(pkg.resources?.length, 2);
  });

  it("pages through a resource until it is exhausted", async () => {
    const records = Array.from({ length: 2500 }, (_, i) => permitRow({}, i + 1));
    const { fetchImpl, calls } = createCkanFetch({ records });

    const page = await connector(fetchImpl, { pageSize: 1000 }).fetchRecords({
      resourceId: "res-1",
    });

    assert.equal(page.records.length, 2500, "every row is returned");
    assert.equal(page.total, 2500);
    // 1000 + 1000 + 500 — the short third page ends the loop.
    assert.equal(calls.length, 3, `expected 3 requests, got ${calls.length}`);
    assert.equal(page.records[0]._id, 1);
    assert.equal(page.records[2499]._id, 2500);
  });

  it("stops at maxRecords without reading the rest", async () => {
    const records = Array.from({ length: 5000 }, (_, i) => permitRow({}, i + 1));
    const { fetchImpl, calls } = createCkanFetch({ records });

    const page = await connector(fetchImpl, { pageSize: 1000 }).fetchRecords({
      resourceId: "res-1",
      maxRecords: 1500,
    });

    assert.equal(page.records.length, 1500);
    assert.equal(calls.length, 2, "no request is made for rows that were not wanted");
  });

  it("stops on an empty page even when `total` claims more", async () => {
    // Trusting `total` alone is how a paging bug becomes an infinite loop
    // against somebody else's server.
    let served = 0;
    const fetchImpl = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/package_show")) {
        return new Response(JSON.stringify({ success: true, result: packageResponse() }));
      }
      served += 1;
      return new Response(
        JSON.stringify({
          success: true,
          result: { resource_id: "r", fields: PERMIT_FIELDS, records: [], total: 999999 },
        }),
      );
    }) as unknown as typeof fetch;

    const page = await connector(fetchImpl).fetchRecords({ resourceId: "res-1" });
    assert.equal(page.records.length, 0);
    assert.equal(served, 1, "one empty page ends the loop");
  });
});

describe("MontrealOpenDataConnector — failures", () => {
  it("classifies a network failure", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => connector(fetchImpl).fetchRecords({ resourceId: "r" }),
      (error: MontrealOpenDataError) => {
        assert.equal(error.kind, "network");
        return true;
      },
    );
  });

  it("classifies a timeout", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;

    await assert.rejects(
      () => connector(fetchImpl, { timeoutMs: 20 }).fetchRecords({ resourceId: "r" }),
      (error: MontrealOpenDataError) => {
        assert.equal(error.kind, "timeout");
        assert.match(error.message, /timed out after 20ms/);
        return true;
      },
    );
  });

  it("explains that a 403 on an open portal came from something in between", async () => {
    const { fetchImpl } = createCkanFetch({ status: 403 });
    await assert.rejects(
      () => connector(fetchImpl).fetchRecords({ resourceId: "r" }),
      (error: MontrealOpenDataError) => {
        assert.equal(error.kind, "http");
        assert.equal(error.status, 403);
        assert.match(error.message, /proxy, firewall or egress policy/);
        return true;
      },
    );
  });

  it("treats a 200 carrying `success: false` as a refusal, not a success", async () => {
    // The classic mistake against CKAN: it answers 200 and puts the failure in
    // the body.
    const { fetchImpl } = createCkanFetch({ refuse: "Resource not found" });
    await assert.rejects(
      () => connector(fetchImpl).fetchRecords({ resourceId: "missing" }),
      (error: MontrealOpenDataError) => {
        assert.equal(error.kind, "http");
        assert.match(error.message, /Resource not found/);
        return true;
      },
    );
  });

  it("rejects a 200 that is not JSON", async () => {
    const fetchImpl = (async () =>
      new Response("<html>maintenance</html>", { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(
      () => connector(fetchImpl).fetchRecords({ resourceId: "r" }),
      (error: MontrealOpenDataError) => {
        assert.equal(error.kind, "malformed");
        return true;
      },
    );
  });

  it("rejects a success with no records array", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ success: true, result: { resource_id: "r" } }), {
        status: 200,
      })) as unknown as typeof fetch;
    await assert.rejects(
      () => connector(fetchImpl).fetchRecords({ resourceId: "r" }),
      (error: MontrealOpenDataError) => {
        assert.equal(error.kind, "malformed");
        assert.match(error.message, /no "records" array/);
        return true;
      },
    );
  });
});

describe("the field contract", () => {
  it("resolves every declared field from the expected columns", () => {
    const resolved = resolveFields(MONTREAL_PERMITS, PERMIT_FIELDS);
    assert.deepEqual(resolved.missingRequired, []);
    assert.deepEqual(resolved.missingOptional, []);
    assert.equal(resolved.map.borough, "arrondissement");
    assert.equal(resolved.map.issuedDate, "date_emission");
  });

  it("matches a column whose case and accents differ", () => {
    const resolved = resolveFields(MONTREAL_PERMITS, [
      { id: "NOM_ARRONDISSEMENT", type: "text" },
      { id: "DATE_ÉMISSION", type: "text" },
    ]);
    assert.deepEqual(resolved.missingRequired, []);
    assert.equal(resolved.map.borough, "NOM_ARRONDISSEMENT");
    assert.equal(resolved.map.issuedDate, "DATE_ÉMISSION");
  });

  it("falls back to the keys of a row when the portal omits `fields`", () => {
    const resolved = resolveFields(MONTREAL_PERMITS, undefined, permitRow());
    assert.deepEqual(resolved.missingRequired, []);
    assert.equal(resolved.map.borough, "arrondissement");
  });

  it("reports a required column that matched nothing", () => {
    const resolved = resolveFields(MONTREAL_PERMITS, [
      { id: "secteur", type: "text" },
      { id: "date_emission", type: "text" },
    ]);
    assert.deepEqual(resolved.missingRequired, ["borough"]);
  });

  it("reports missing optional columns without failing", () => {
    const resolved = resolveFields(MONTREAL_PERMITS, [
      { id: "arrondissement", type: "text" },
      { id: "date_emission", type: "text" },
    ]);
    assert.deepEqual(resolved.missingRequired, []);
    assert.deepEqual(
      resolved.missingOptional.sort(),
      ["category", "declaredValue", "dwellingUnits"],
    );
  });

  it("writes a mismatch report an operator can act on", () => {
    const resolved = resolveFields(MONTREAL_PERMITS, [
      { id: "secteur", type: "text" },
      { id: "jour", type: "text" },
    ]);
    const message = describeSchemaMismatch(MONTREAL_PERMITS, resolved);

    assert.match(message, /borough/, "names what is missing");
    assert.match(message, /arrondissement/, "names what it tried");
    assert.match(message, /secteur, jour/, "names what actually arrived");
    assert.match(message, /Nothing was written/);
    assert.match(message, /datasets\.ts/, "points at the file to edit");
  });

  it("declares the contract as unverified until a real import confirms it", () => {
    // Access to donnees.montreal.ca is blocked in this environment, so the
    // column names come from documentation rather than a live response. Saying
    // so in the data — and asserting it here — keeps the claim honest.
    assert.equal(MONTREAL_PERMITS.fieldsVerified, false);
  });

  it("folds column names consistently", () => {
    assert.equal(foldColumnName("DATE_ÉMISSION"), "date_emission");
    assert.equal(foldColumnName("Nombre de logements"), "nombre_de_logements");
  });
});

describe("classifyPermitCategory", () => {
  it("classifies the common French work descriptions", () => {
    assert.equal(classifyPermitCategory("Nouvelle construction"), "new-construction");
    assert.equal(classifyPermitCategory("Rénovation intérieure"), "renovation");
    assert.equal(classifyPermitCategory("Transformation"), "renovation");
    assert.equal(classifyPermitCategory("Agrandissement"), "renovation");
    assert.equal(classifyPermitCategory("Démolition"), "demolition");
  });

  it("checks demolition before renovation", () => {
    // "Démolition partielle et reconstruction" contains both signals. A
    // partial demolition is a demolition permit.
    assert.equal(
      classifyPermitCategory("Démolition partielle et reconstruction"),
      "demolition",
    );
  });

  it("puts anything unrecognised in `other` rather than dropping it", () => {
    assert.equal(classifyPermitCategory("Certificat d'occupation"), "other");
    assert.equal(classifyPermitCategory(null), "other");
    assert.equal(classifyPermitCategory(""), "other");
    assert.equal(classifyPermitCategory(42), "other");
  });
});

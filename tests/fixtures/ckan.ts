import type { CkanDatastoreResult, CkanPackageResult } from "@/lib/pipeline/connectors/montreal-open-data/types";

/**
 * CKAN fixtures.
 *
 * ⚠️ These reproduce the **documented** CKAN Action API envelope, which is a
 * stable published standard, and a **plausible** set of Montréal permit columns,
 * which is not verified — outbound access to `donnees.montreal.ca` is blocked in
 * the environment this was built in, and that restriction was reported rather
 * than worked around.
 *
 * That is exactly why the pipeline resolves its field contract against the
 * response instead of assuming column names: these fixtures prove the resolution
 * works, including when it *fails*, so a real response with different columns
 * produces a clear `schema-mismatch` rather than a table of zeroes.
 */

export function ckanEnvelope<T>(result: T, success = true) {
  return { help: "https://donnees.montreal.ca/api/3/action/help_show", success, result };
}

export function packageResponse(
  overrides: Partial<CkanPackageResult> = {},
): CkanPackageResult {
  return {
    id: "9b1b2f2e-0000-4000-8000-000000000001",
    name: "permis-construction",
    title: "Permis de construction",
    license_id: "cc-by",
    license_title: "Creative Commons Attribution 4.0",
    metadata_modified: "2026-08-01T13:20:00.000000",
    organization: { title: "Ville de Montréal", name: "ville-de-montreal" },
    resources: [
      {
        id: "aaaaaaaa-1111-4000-8000-000000000001",
        name: "Permis de construction (PDF)",
        format: "PDF",
        datastore_active: false,
        last_modified: "2026-07-01T10:00:00",
      },
      {
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        name: "Permis de construction",
        format: "CSV",
        datastore_active: true,
        last_modified: "2026-08-01T10:00:00",
      },
    ],
    ...overrides,
  };
}

/** The column set the field contract expects to find. */
export const PERMIT_FIELDS: CkanDatastoreResult["fields"] = [
  { id: "_id", type: "int4" },
  { id: "no_permis", type: "text" },
  { id: "arrondissement", type: "text" },
  { id: "date_emission", type: "text" },
  { id: "nature_travaux", type: "text" },
  { id: "valeur_travaux", type: "numeric" },
  { id: "nombre_logements", type: "int4" },
];

export interface PermitRowInput {
  borough?: string;
  date?: string;
  nature?: string;
  value?: unknown;
  units?: unknown;
}

export function permitRow(input: PermitRowInput = {}, index = 1): Record<string, unknown> {
  return {
    _id: index,
    no_permis: `3001-26-${String(index).padStart(5, "0")}`,
    arrondissement: input.borough ?? "Le Sud-Ouest",
    date_emission: input.date ?? "2026-05-14",
    nature_travaux: input.nature ?? "Rénovation intérieure",
    valeur_travaux: input.value ?? 85000,
    nombre_logements: input.units ?? 0,
  };
}

export function datastoreResponse(
  records: Array<Record<string, unknown>>,
  overrides: Partial<CkanDatastoreResult> = {},
): CkanDatastoreResult {
  return {
    resource_id: "bbbbbbbb-2222-4000-8000-000000000002",
    fields: PERMIT_FIELDS,
    records,
    total: records.length,
    limit: 1000,
    offset: 0,
    ...overrides,
  };
}

/**
 * A `fetch` stand-in that answers `package_show` and pages `datastore_search`.
 *
 * Paging is implemented for real — it honours `limit` and `offset` — because
 * the pagination loop is the part of the connector most likely to have an
 * off-by-one, and a fixture that returns everything in one page would never
 * exercise it.
 */
export function createCkanFetch(options: {
  records?: Array<Record<string, unknown>>;
  fields?: CkanDatastoreResult["fields"];
  pkg?: CkanPackageResult;
  /** Force a status on every datastore request. */
  status?: number;
  /** Return `success: false` with this message. */
  refuse?: string;
}) {
  const records = options.records ?? [];
  const calls: string[] = [];

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());

    if (options.status && options.status >= 400) {
      return new Response(
        JSON.stringify({ success: false, error: { message: "denied" } }),
        { status: options.status, headers: { "content-type": "application/json" } },
      );
    }

    if (options.refuse) {
      return new Response(
        JSON.stringify({ success: false, error: { __type: "Not Found Error", message: options.refuse } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname.endsWith("/package_show")) {
      return json(ckanEnvelope(options.pkg ?? packageResponse()));
    }

    const limit = Number(url.searchParams.get("limit") ?? "1000");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const page = records.slice(offset, offset + limit);

    return json(
      ckanEnvelope(
        datastoreResponse(page, {
          fields: options.fields ?? PERMIT_FIELDS,
          total: records.length,
          limit,
          offset,
        }),
      ),
    );
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

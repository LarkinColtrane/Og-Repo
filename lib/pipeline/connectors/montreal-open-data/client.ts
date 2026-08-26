import type {
  CkanDatastoreResult,
  CkanEnvelope,
  CkanPackageResult,
} from "./types";

/**
 * Ville de Montréal open-data connector, over the CKAN Action API.
 *
 * Its whole job is: make an HTTP request, confirm the response is the shape it
 * claims to be, and hand back typed data. It knows nothing about boroughs,
 * permits or our database.
 *
 * **This is the publisher's own machine-readable API. Nothing here scrapes a
 * web page**, and nothing here needs a key — `donnees.montreal.ca` is open data
 * published under Creative Commons Attribution 4.0.
 *
 * @see https://donnees.montreal.ca/
 * @see https://docs.ckan.org/en/latest/api/
 */

export const MONTREAL_CKAN_BASE_URL = "https://donnees.montreal.ca/api/3/action";

/** How the request failed, so the caller can decide whether a retry is sane. */
export type CkanErrorKind =
  /** DNS, TLS, refused connection, or a proxy that denied the host. */
  | "network"
  /** The request exceeded the connector's timeout. */
  | "timeout"
  /** A 4xx or 5xx, or a 200 carrying `success: false`. */
  | "http"
  /** A 200 whose body was not the documented shape. */
  | "malformed";

export class MontrealOpenDataError extends Error {
  constructor(
    message: string,
    readonly kind: CkanErrorKind,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MontrealOpenDataError";
  }
}

export interface MontrealOpenDataConnectorOptions {
  /** Injected so tests can supply a fixture and no network is needed. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
  /**
   * Rows per `datastore_search` page.
   *
   * CKAN caps this server-side (commonly 32 000). 1 000 is a deliberate
   * compromise: large enough that a year of permits is a handful of requests,
   * small enough that a failure loses little work and that a free public portal
   * is not asked for tens of megabytes in one response.
   */
  pageSize?: number;
}

export interface DatastoreQuery {
  resourceId: string;
  /**
   * Column filters, sent as CKAN's `filters` parameter — server-side, so an
   * unwanted year is never transferred at all. CKAN matches these exactly; it
   * has no range operator, which is why date windows are applied after
   * normalization rather than here.
   */
  filters?: Record<string, string | number>;
  /** Full-text query across the resource. */
  q?: string;
  /** Stop after this many rows in total. Omit to read the whole resource. */
  maxRecords?: number;
  signal?: AbortSignal;
}

export interface DatastorePage {
  fields: CkanDatastoreResult["fields"];
  records: Array<Record<string, unknown>>;
  total: number | null;
  requestUrl: string;
}

export class MontrealOpenDataConnector {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly pageSize: number;

  constructor(options: MontrealOpenDataConnectorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.baseUrl = options.baseUrl ?? MONTREAL_CKAN_BASE_URL;
    this.pageSize = options.pageSize ?? 1000;
  }

  /** The URL a datastore page will be requested from. Exposed for logging. */
  buildDatastoreUrl(query: DatastoreQuery, offset = 0, limit = this.pageSize): string {
    const url = new URL(`${this.baseUrl}/datastore_search`);
    url.searchParams.set("resource_id", query.resourceId);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    if (query.q) url.searchParams.set("q", query.q);
    if (query.filters && Object.keys(query.filters).length > 0) {
      url.searchParams.set("filters", JSON.stringify(query.filters));
    }
    return url.toString();
  }

  buildPackageUrl(datasetSlug: string): string {
    const url = new URL(`${this.baseUrl}/package_show`);
    url.searchParams.set("id", datasetSlug);
    return url.toString();
  }

  /** Dataset metadata: licence, last modification, resource list. */
  async fetchPackage(
    datasetSlug: string,
    signal?: AbortSignal,
  ): Promise<CkanPackageResult> {
    const url = this.buildPackageUrl(datasetSlug);
    const result = await this.request<CkanPackageResult>(url, signal);
    if (typeof result.id !== "string" || !Array.isArray(result.resources)) {
      throw new MontrealOpenDataError(
        `package_show for "${datasetSlug}" returned no id or no resource list.`,
        "malformed",
      );
    }
    return result;
  }

  /**
   * Read a resource, following CKAN pagination until it is exhausted.
   *
   * Pages are accumulated rather than streamed because the caller aggregates
   * anyway — but `maxRecords` exists so a caller (or a test) can bound the work
   * without discovering the size of a municipal dataset the hard way.
   *
   * The loop stops on three conditions, and the third one matters: a page that
   * returns fewer rows than requested is the last page, *and* a page that
   * returns zero rows stops the loop even if `total` claims more. Trusting
   * `total` alone is how a paging bug becomes an infinite loop against
   * somebody else's server.
   */
  async fetchRecords(query: DatastoreQuery): Promise<DatastorePage> {
    const records: Array<Record<string, unknown>> = [];
    let fields: CkanDatastoreResult["fields"];
    let total: number | null = null;
    let offset = 0;
    const firstUrl = this.buildDatastoreUrl(query, 0);

    for (;;) {
      const remaining =
        query.maxRecords === undefined ? this.pageSize : query.maxRecords - records.length;
      if (remaining <= 0) break;

      const limit = Math.min(this.pageSize, remaining);
      const url = this.buildDatastoreUrl(query, offset, limit);
      const result = await this.request<CkanDatastoreResult>(url, query.signal);

      if (!Array.isArray(result.records)) {
        throw new MontrealOpenDataError(
          `datastore_search returned no "records" array: ${url}`,
          "malformed",
        );
      }

      if (!fields && Array.isArray(result.fields)) fields = result.fields;
      if (total === null && typeof result.total === "number") total = result.total;

      records.push(...result.records);

      if (result.records.length === 0) break;
      if (result.records.length < limit) break;
      offset += result.records.length;
    }

    return { fields, records, total, requestUrl: firstUrl };
  }

  /**
   * One request, with a timeout and full error classification.
   *
   * CKAN can fail in a way HTTP does not describe: `200 OK` with
   * `{"success": false, "error": {...}}`. Treating that as success is the
   * classic mistake against this API, so `success` is checked explicitly and a
   * false one is classified as `http` — it is an application-level refusal, not
   * a malformed body.
   */
  private async request<T>(url: string, signal?: AbortSignal): Promise<T> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combined = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: combined,
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new MontrealOpenDataError(
          `Ville de Montréal open-data request timed out after ${this.timeoutMs}ms: ${url}`,
          "timeout",
          undefined,
          error,
        );
      }
      throw new MontrealOpenDataError(
        `Could not reach the Ville de Montréal open-data portal at ${url}. ${describe(error)}`,
        "network",
        undefined,
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    const payload = (await safeJson(response)) as CkanEnvelope<T> | null;

    if (!response.ok) {
      // The portal is open data and needs no credentials, so a 401 or 403
      // almost never comes from the city — it comes from something in between.
      // Saying so turns a baffling error into an actionable one.
      const egressHint =
        response.status === 403 || response.status === 401
          ? " This portal is open data and requires no credentials, so this status most likely came from a proxy, firewall or egress policy between this host and donnees.montreal.ca rather than from the city."
          : "";

      throw new MontrealOpenDataError(
        (payload?.error?.message
          ? `Ville de Montréal open data returned ${response.status}: ${payload.error.message}`
          : `Ville de Montréal open data returned ${response.status} ${response.statusText}.`) +
          egressHint,
        "http",
        response.status,
      );
    }

    if (payload === null) {
      throw new MontrealOpenDataError(
        `Ville de Montréal open data returned a 200 that was not JSON: ${url}`,
        "malformed",
        response.status,
      );
    }

    if (payload.success !== true) {
      throw new MontrealOpenDataError(
        `Ville de Montréal open data refused the request: ${payload.error?.message ?? payload.error?.__type ?? "no reason given"} (${url})`,
        "http",
        response.status,
      );
    }

    if (payload.result === undefined || payload.result === null) {
      throw new MontrealOpenDataError(
        `Ville de Montréal open data returned success with no result: ${url}`,
        "malformed",
        response.status,
      );
    }

    return payload.result;
  }
}

async function safeJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

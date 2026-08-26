import type { ValetErrorResponse, ValetObservationsResponse } from "./types";

/**
 * Bank of Canada Valet API connector.
 *
 * Its entire job is: make an HTTP request, confirm the response is the shape it
 * claims to be, and hand back typed data. It knows nothing about our database,
 * our series codes or what a bond yield means — that is deliberate, and it is
 * what makes the connector testable against a fixture with no network at all.
 *
 * The API is public, keyless and documented. Nothing here scrapes a web page.
 *
 * @see https://www.bankofcanada.ca/valet/docs
 */

export const VALET_BASE_URL = "https://www.bankofcanada.ca/valet";

/** How the request failed, so the caller can decide whether a retry is sane. */
export type ConnectorErrorKind =
  /** DNS, TLS, refused connection, or a proxy that denied the host. */
  | "network"
  /** The request exceeded the connector's timeout. */
  | "timeout"
  /** A 4xx or 5xx from the API. */
  | "http"
  /** A 200 whose body was not the documented shape. */
  | "malformed";

export class BankOfCanadaError extends Error {
  constructor(
    message: string,
    readonly kind: ConnectorErrorKind,
    /** HTTP status, when there was one. */
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BankOfCanadaError";
  }
}

export interface FetchObservationsOptions {
  /** The Valet series name, e.g. `BD.CDN.5YR.DQ.YLD`. */
  upstreamCode: string;
  /** Inclusive `YYYY-MM-DD` lower bound. */
  startDate?: string;
  /** Inclusive `YYYY-MM-DD` upper bound. */
  endDate?: string;
  /** Alternative to a date range: the N most recent observations. */
  recent?: number;
  signal?: AbortSignal;
}

export interface BankOfCanadaConnectorOptions {
  /**
   * Injected so tests can supply a fixture and so a future implementation can
   * add retries or caching without this class changing.
   */
  fetchImpl?: typeof fetch;
  /** Milliseconds before the request is abandoned. */
  timeoutMs?: number;
  baseUrl?: string;
}

/**
 * A thin, typed client for the observations endpoint.
 *
 * Generic over the series: adding the 10-year bond or the policy rate needs no
 * change here, only a registry entry.
 */
export class BankOfCanadaConnector {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: BankOfCanadaConnectorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.baseUrl = options.baseUrl ?? VALET_BASE_URL;
  }

  /** The exact URL this connector will request. Exposed for logging and tests. */
  buildUrl(options: FetchObservationsOptions): string {
    const url = new URL(
      `${this.baseUrl}/observations/${encodeURIComponent(options.upstreamCode)}/json`,
    );
    if (options.recent !== undefined) {
      url.searchParams.set("recent", String(options.recent));
    } else {
      if (options.startDate) url.searchParams.set("start_date", options.startDate);
      if (options.endDate) url.searchParams.set("end_date", options.endDate);
    }
    return url.toString();
  }

  async fetchObservations(
    options: FetchObservationsOptions,
  ): Promise<ValetObservationsResponse> {
    const url = this.buildUrl(options);

    // Own timeout, combined with any caller-supplied signal. Without a timeout a
    // hung upstream would hold an ingest run open indefinitely and the pipeline
    // would look "running" rather than broken.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal,
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new BankOfCanadaError(
          `Bank of Canada request timed out after ${this.timeoutMs}ms: ${url}`,
          "timeout",
          undefined,
          error,
        );
      }
      throw new BankOfCanadaError(
        `Could not reach the Bank of Canada Valet API at ${url}. ${describe(error)}`,
        "network",
        undefined,
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Valet returns a JSON envelope with a `message` on 4xx; a proxy or an
      // outage may return HTML. Try the useful one, fall back to the status.
      const body = (await safeJson(response)) as ValetErrorResponse | null;

      // The Valet API is public and keyless, so it has nothing to authorise. A
      // 401 or 403 therefore almost never comes from the Bank — it comes from
      // something between us and them. Saying so turns a baffling error into an
      // actionable one.
      const egressHint =
        response.status === 403 || response.status === 401
          ? " The Valet API is public and requires no credentials, so this status most likely came from a proxy, firewall or egress policy between this host and bankofcanada.ca rather than from the Bank itself."
          : "";

      throw new BankOfCanadaError(
        (body?.message
          ? `Bank of Canada API returned ${response.status}: ${body.message}`
          : `Bank of Canada API returned ${response.status} ${response.statusText}.`) + egressHint,
        "http",
        response.status,
      );
    }

    const payload = await safeJson(response);
    if (payload === null) {
      throw new BankOfCanadaError(
        `Bank of Canada API returned a 200 that was not JSON: ${url}`,
        "malformed",
        response.status,
      );
    }

    return assertObservationsShape(payload, url);
  }
}

/**
 * Structural check before the payload leaves the connector.
 *
 * This is *not* the validation layer — it does not judge whether a yield is
 * plausible. It only refuses to pretend that something without an
 * `observations` array is a Valet response, so the normalizer can rely on the
 * shape and the failure is reported here rather than as a confusing `undefined`
 * three modules later.
 */
function assertObservationsShape(
  payload: unknown,
  url: string,
): ValetObservationsResponse {
  if (typeof payload !== "object" || payload === null) {
    throw new BankOfCanadaError(
      `Bank of Canada response was ${payload === null ? "null" : typeof payload}, expected an object: ${url}`,
      "malformed",
    );
  }

  const candidate = payload as ValetObservationsResponse;
  if (!Array.isArray(candidate.observations)) {
    throw new BankOfCanadaError(
      `Bank of Canada response has no "observations" array: ${url}`,
      "malformed",
    );
  }

  return candidate;
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

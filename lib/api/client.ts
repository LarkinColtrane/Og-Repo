import type {
  ApiErrorBody,
  ApiErrorCode,
  ApiResponse,
  CityOverview,
  ComparisonRow,
  DataSource,
  Neighbourhood,
  NeighbourhoodSnapshot,
  RentalMarketStat,
  SaleMarketStat,
} from "@/types";

/**
 * Typed client for this application's own API.
 *
 * Interactive components fetch through here rather than importing the data layer
 * directly. That is the whole point of the exercise: a filter change in the browser
 * becomes a real HTTP request to a real endpoint, so the boundary you would later
 * put a database behind is already load-bearing rather than theoretical.
 *
 * Server components skip this and call `getRepository()` directly — an HTTP hop to
 * your own process on the server would be pure overhead.
 */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode | "NETWORK_ERROR",
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function fetchApi<T>(path: string, signal?: AbortSignal): Promise<ApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    // An aborted request is a normal part of a fast-changing filter, not a failure.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiRequestError(
      "Could not reach the market data service. Check your connection and try again.",
      "NETWORK_ERROR",
      0,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(
      body?.error?.message ?? `Request failed with status ${response.status}.`,
      body?.error?.code ?? "INTERNAL_ERROR",
      response.status,
    );
  }

  return (await response.json()) as ApiResponse<T>;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : "";
}

export const api = {
  cityOverview: (signal?: AbortSignal) =>
    fetchApi<CityOverview>("/api/market/montreal", signal),

  neighbourhoods: (signal?: AbortSignal) =>
    fetchApi<Neighbourhood[]>("/api/neighbourhoods", signal),

  snapshot: (slug: string, signal?: AbortSignal) =>
    fetchApi<NeighbourhoodSnapshot>(`/api/neighbourhoods/${slug}`, signal),

  sales: (
    slug: string,
    params: { propertyType?: string; range?: string } = {},
    signal?: AbortSignal,
  ) => fetchApi<SaleMarketStat[]>(`/api/neighbourhoods/${slug}/sales${query(params)}`, signal),

  rent: (
    slug: string,
    params: { bedroomType?: string; range?: string } = {},
    signal?: AbortSignal,
  ) => fetchApi<RentalMarketStat[]>(`/api/neighbourhoods/${slug}/rent${query(params)}`, signal),

  compare: (slugs: string[], signal?: AbortSignal) =>
    fetchApi<ComparisonRow[]>(`/api/compare${query({ slugs: slugs.join(",") })}`, signal),

  dataSources: (signal?: AbortSignal) => fetchApi<DataSource[]>("/api/data-sources", signal),
};

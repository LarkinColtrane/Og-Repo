import { getPermitSeries } from "@/lib/data/civic-service";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { describeValidationError, parseSearchParams, permitQuerySchema } from "@/lib/api/params";
import { getMunicipality } from "@/lib/geo/montreal";

/**
 * `GET /api/civic/permits`
 *
 * Construction permit activity by borough-month.
 *
 * ```
 * ?neighbourhood=griffintown&months=24
 * ?borough=le-sud-ouest&from=2024-01&to=2026-06
 * ?months=36                              // city-wide only
 * ```
 *
 * ## The browser never talks to the city
 *
 * The request goes to our own endpoint, which reads what the ingest pipeline
 * stored. That keeps the Ville de Montréal portal contacted once per import
 * rather than once per visitor, keeps the page working when the portal is down,
 * and means a change of upstream is a change to one connector rather than to
 * every component that shows a permit count. Same rule as the benchmark
 * endpoint, and the reason both exist.
 *
 * ## `neighbourhood` returns a borough figure, and says so
 *
 * Asking for `griffintown` returns Le Sud-Ouest statistics plus an
 * `attribution` object explaining that the borough is wider than the
 * neighbourhood. The caption is composed in the service layer from the coverage
 * recorded in `lib/geo/montreal.ts` — a client cannot relabel a borough number
 * with a neighbourhood name, because it does not write the label.
 */
export async function GET(request: Request) {
  return withErrorHandling(async () => {
    const parsed = parseSearchParams(request.url, permitQuerySchema);
    if (!parsed.success) {
      return apiError("INVALID_REQUEST", describeValidationError(parsed.error));
    }
    const query = parsed.data;

    if (query.borough && !getMunicipality(query.borough)) {
      return apiError(
        "NOT_FOUND",
        `"${query.borough}" is not a Montréal borough or linked city this platform knows.`,
      );
    }

    const series = await getPermitSeries({
      neighbourhoodSlug: query.neighbourhood,
      boroughCode: query.borough,
      months: query.months,
      from: query.from,
      to: query.to,
    });

    if (query.neighbourhood && !series.attribution) {
      return apiError(
        "NOT_FOUND",
        `No borough is recorded for the neighbourhood "${query.neighbourhood}". Borough data is only served for neighbourhoods with an explicit link in lib/geo/montreal.ts — an unmapped one is a gap to fill, not a lookup to guess at.`,
      );
    }

    return apiSuccess(
      {
        boroughCode: series.boroughCode,
        boroughName: series.boroughName,
        observations: series.observations,
        city: series.city,
        latestPeriod: series.latestPeriod,
        attribution: series.attribution,
      },
      {
        period: series.latestPeriod ?? new Date().toISOString().slice(0, 7),
        sources: series.sources,
        dataQuality: series.dataQuality,
        // Monthly municipal statistics change at most once a month; an hour of
        // shared caching costs nothing in freshness and takes the portal's data
        // off the critical path for every visitor.
        maxAge: 3600,
      },
    );
  });
}

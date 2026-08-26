/**
 * The shape the Bank of Canada Valet API actually returns.
 *
 * These types describe *their* response, quirks included, and nothing outside
 * this connector directory should import them. The normalizer's job is to turn
 * them into our canonical `BenchmarkObservation` so that a change at the
 * publisher's end is a change to one transform rather than to the whole app.
 *
 * The quirk worth knowing: every observation value arrives as a **string**
 * (`{"v": "3.21"}`), and a day with no published value arrives as an empty
 * string or is absent entirely. Treating `v` as a number here would work right
 * up until the first holiday.
 *
 * @see https://www.bankofcanada.ca/valet/docs
 */

/** One value inside an observation row. */
export interface ValetObservationValue {
  /** The value, as a string. Empty when the publisher reports no figure. */
  v: string | null;
}

/**
 * One row of the `observations` array.
 *
 * `d` is the observation date. Every other key is a series name whose value is a
 * `{ v }` object — which is why this is an index signature rather than a fixed
 * shape: the caller decides which series it asked for.
 */
export interface ValetObservationRow {
  d: string;
  [seriesName: string]: string | ValetObservationValue | undefined;
}

export interface ValetSeriesDetail {
  label?: string;
  description?: string;
  dimension?: { key: string; name: string };
}

export interface ValetObservationsResponse {
  terms?: { url?: string };
  seriesDetail?: Record<string, ValetSeriesDetail>;
  observations?: ValetObservationRow[];
}

/** The API's own error envelope, returned with a 4xx. */
export interface ValetErrorResponse {
  message?: string;
  docs?: string;
}

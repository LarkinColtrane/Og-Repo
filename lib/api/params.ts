import { z } from "zod";
import { BEDROOM_TYPES, PROPERTY_TYPES, TREND_RANGES } from "@/types";
import type { Period, TrendRange } from "@/types";
import { addMonths } from "@/lib/periods";
import { isValidIsoDate } from "@/lib/calculations/business-days";
import { TREND_RANGE_MONTHS } from "@/types";

/**
 * Query-string validation.
 *
 * Everything arriving from a URL is a string of unknown provenance. Parsing it
 * through a schema at the edge of the API means the rest of the code can work with
 * real types and never re-check, and a malformed request gets a clear 400 instead
 * of a confusing empty result.
 */

export const propertyTypeSchema = z.enum(
  PROPERTY_TYPES as unknown as [string, ...string[]],
);
export const bedroomTypeSchema = z.enum(
  BEDROOM_TYPES as unknown as [string, ...string[]],
);
export const trendRangeSchema = z.enum(TREND_RANGES as unknown as [string, ...string[]]);
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a period in YYYY-MM form.");

export const saleStatsQuerySchema = z.object({
  propertyType: propertyTypeSchema.optional(),
  range: trendRangeSchema.optional(),
  from: periodSchema.optional(),
  to: periodSchema.optional(),
});

export const rentalStatsQuerySchema = z.object({
  bedroomType: bedroomTypeSchema.optional(),
  range: trendRangeSchema.optional(),
  from: periodSchema.optional(),
  to: periodSchema.optional(),
});

export const compareQuerySchema = z.object({
  /** Comma-separated slugs, capped at four to match the comparison UI. */
  slugs: z
    .string()
    .min(1, "Provide at least one neighbourhood slug.")
    .transform((value) =>
      value
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean),
    )
    .refine((slugs) => slugs.length > 0, "Provide at least one neighbourhood slug.")
    .refine((slugs) => slugs.length <= 4, "Compare at most four neighbourhoods at once."),
});

/* ── Mortgage endpoints ───────────────────────────────────────────────────── */

export const productTypeSchema = z.enum(["fixed", "variable"]);
export const borrowerProfileSchema = z.enum(["insured", "uninsured"]);
export const occupancySchema = z.enum(["owner-occupied", "investment"]);

/** Coerce a query-string number and bound it, so a URL cannot produce nonsense. */
const boundedNumber = (min: number, max: number) =>
  z.coerce.number().min(min).max(max);

export const mortgageRatesQuerySchema = z.object({
  lenderId: z.string().min(1).optional(),
  productType: productTypeSchema.optional(),
  termYears: boundedNumber(1, 10).optional(),
  borrowerProfile: borrowerProfileSchema.optional(),
});

/**
 * `GET /api/mortgage/compare`.
 *
 * The bounds are deliberate rather than decorative: an unbounded amortization or
 * a negative price would produce a plausible-looking payment from meaningless
 * inputs, and a caller would have no way to tell.
 */
export const mortgageCompareQuerySchema = z.object({
  price: boundedNumber(1, 100_000_000),
  downPaymentPercent: boundedNumber(0, 100),
  amortizationYears: boundedNumber(1, 40).default(25),
  termYears: boundedNumber(1, 10).default(5),
  productType: productTypeSchema.default("fixed"),
  occupancy: occupancySchema.default("investment"),
  units: boundedNumber(1, 12).default(1),
});

/* ── Market benchmarks ────────────────────────────────────────────────────── */

export const benchmarkSeriesSchema = z.enum([
  "5y-canada-bond",
  "10y-canada-bond",
  "boc-policy-rate",
]);

export const benchmarkRangeSchema = z.enum(["3m", "1y", "3y", "5y"]);

export const benchmarkQuerySchema = z.object({
  series: benchmarkSeriesSchema.default("5y-canada-bond"),
  range: benchmarkRangeSchema.default("1y"),
});

/** `YYYY-MM-DD`, checked for a date that actually exists. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD form.")
  .refine(isValidIsoDate, "That calendar date does not exist.");

/**
 * Body accepted by the internal ingest endpoint.
 *
 * Either a date range or `recent`, not both — asking for both is a caller that
 * has not decided what it wants, and guessing on their behalf is how a backfill
 * silently becomes a five-row import.
 */
export const bankOfCanadaIngestSchema = z
  .object({
    series: benchmarkSeriesSchema.default("5y-canada-bond"),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    recent: z.coerce.number().int().min(1).max(10_000).optional(),
    triggeredBy: z.enum(["manual", "schedule", "webhook"]).default("manual"),
  })
  .refine(
    (body) => !(body.recent !== undefined && (body.startDate || body.endDate)),
    { message: "Provide either a date range or `recent`, not both." },
  )
  .refine(
    (body) => !(body.startDate && body.endDate) || body.startDate <= body.endDate,
    { message: "`startDate` must not be after `endDate`." },
  );

/* ── Civic data ───────────────────────────────────────────────────────────── */

/**
 * `GET /api/civic/permits`.
 *
 * `neighbourhood` and `borough` are alternatives, not a pair. Accepting both
 * would mean deciding which wins, and either answer surprises half the callers —
 * so the schema refuses instead.
 */
export const permitQuerySchema = z
  .object({
    neighbourhood: z.string().min(1).max(80).optional(),
    borough: z.string().min(1).max(80).optional(),
    /** Months of history, counted back from the latest period on record. */
    months: z.coerce.number().int().min(1).max(240).default(24),
    from: periodSchema.optional(),
    to: periodSchema.optional(),
  })
  .refine((query) => !(query.neighbourhood && query.borough), {
    message: "Provide either `neighbourhood` or `borough`, not both.",
  })
  .refine((query) => !(query.from && query.to) || query.from <= query.to, {
    message: "`from` must not be after `to`.",
  });

/**
 * Body accepted by the civic ingest endpoint.
 *
 * Everything is optional: a bare `POST` imports the whole permit dataset, which
 * is the right default for a first backfill and harmless afterwards because the
 * write upserts.
 */
export const montrealPermitsIngestSchema = z.object({
  dataset: z.string().min(1).optional(),
  from: periodSchema.optional(),
  to: periodSchema.optional(),
  /** Bound the work, so an unattended run cannot read a dataset of unknown size. */
  maxRecords: z.coerce.number().int().min(1).max(1_000_000).optional(),
  triggeredBy: z.enum(["manual", "schedule", "webhook"]).default("manual"),
});

/**
 * Options accepted by the provider-neutral scheduler endpoint.
 *
 * Everything is optional and every default is safe, because a scheduler should
 * be configurable with a bare URL and no body — a Vercel Cron entry is a path
 * and a cron expression, with nowhere to put JSON.
 */
export const scheduledIngestSchema = z.object({
  /** Limit the run to one series. Defaults to every scheduled series. */
  series: benchmarkSeriesSchema.optional(),
  /**
   * Size of the overlapping window, in observations.
   *
   * Ten business days, not one. A scheduled import must re-fetch a window it has
   * already seen: it is how a missed run heals itself on the next execution, and
   * how a value the publisher later revises gets corrected. Writes upsert on
   * `(series, observation_date)`, so re-importing the same ten days is free.
   */
  recent: z.coerce.number().int().min(1).max(1000).default(10),
  /** Set false to run the ingest without sending notifications. */
  notify: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .default(true),
  /**
   * Which pipelines to run, comma-separated. Both by default.
   *
   * A scheduler needing different cadences — the bond yield is business-daily,
   * permits are monthly — points two cron entries at this one URL with
   * different values rather than at two endpoints.
   */
  pipelines: z
    .union([
      z.array(z.enum(["benchmarks", "civic"])),
      z
        .string()
        .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
        .pipe(z.array(z.enum(["benchmarks", "civic"])).min(1)),
    ])
    .default(["benchmarks", "civic"]),
});

/** Turn `?range=3y` into a concrete `from` bound relative to the latest period. */
export function resolveDateBounds(
  latestPeriod: Period,
  query: { range?: string; from?: string; to?: string },
): { from?: Period; to?: Period } {
  const to = query.to ?? latestPeriod;
  if (query.from) return { from: query.from, to };
  if (query.range) {
    const months = TREND_RANGE_MONTHS[query.range as TrendRange];
    return { from: addMonths(to, -(months - 1)), to };
  }
  return { to };
}

/** Collapse a Zod error into one readable sentence for the API envelope. */
export function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join(" ");
}

/** Read and validate a URL's search params against a schema. */
export function parseSearchParams<T extends z.ZodType>(url: string, schema: T) {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  return schema.safeParse(params);
}

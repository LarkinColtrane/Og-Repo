import { z } from "zod";
import { BEDROOM_TYPES, PROPERTY_TYPES, TREND_RANGES } from "@/types";
import type { Period, TrendRange } from "@/types";
import { addMonths } from "@/lib/periods";
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

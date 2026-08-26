import { NextResponse } from "next/server";
import type { ApiErrorBody, ApiErrorCode, ApiMeta, ApiResponse, Attribution } from "@/types";
import { getRepository } from "@/lib/data";

/**
 * Response helpers shared by every route under /api.
 *
 * Two things they guarantee. First, a uniform envelope — `{ data, meta }` on
 * success, `{ error }` on failure — so a client never has to guess at the shape.
 * Second, that `meta.dataQuality` is filled in from the live repository rather
 * than hard-coded, so the day a real database is connected, every response stops
 * announcing itself as demo data automatically.
 */

export interface SuccessOptions {
  /** The reporting month the payload describes. */
  period: string;
  /** Provenance for the statistics in the payload. */
  sources: Attribution[];
  /** Seconds a shared cache may serve this response. Defaults to no caching. */
  maxAge?: number;
  /**
   * Override the quality flag for routes served by a different repository.
   *
   * Mortgage rates come from `MortgageRateRepository`, not the market one, and
   * the two will not become live on the same day. Without this, a route serving
   * live rates would still announce itself as demo because the market data
   * happened to be.
   */
  dataQuality?: "demo" | "live";
}

export function apiSuccess<T>(
  data: T,
  options: SuccessOptions,
): NextResponse<ApiResponse<T>> {
  const meta: ApiMeta = {
    generatedAt: new Date().toISOString(),
    dataQuality: options.dataQuality ?? getRepository().dataQuality,
    period: options.period,
    sources: options.sources,
  };

  const headers: Record<string, string> = {};
  if (options.maxAge && options.maxAge > 0) {
    // Monthly statistics are safe to cache; `stale-while-revalidate` keeps the
    // first request after expiry fast.
    headers["Cache-Control"] =
      `public, s-maxage=${options.maxAge}, stale-while-revalidate=${options.maxAge * 4}`;
  }

  return NextResponse.json({ data, meta }, { headers });
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: STATUS_BY_CODE[code] },
  );
}

/**
 * Wraps a route handler so an unexpected throw becomes a well-formed 500 rather
 * than an HTML error page. Anything the client can act on should be returned as an
 * explicit `apiError` instead of thrown.
 */
export async function withErrorHandling<T>(
  handler: () => Promise<NextResponse<T> | NextResponse<ApiErrorBody>>,
): Promise<NextResponse<T> | NextResponse<ApiErrorBody>> {
  try {
    return await handler();
  } catch (error) {
    console.error("[api] unhandled error", error);
    return apiError(
      "INTERNAL_ERROR",
      "Something went wrong while assembling this response.",
    );
  }
}

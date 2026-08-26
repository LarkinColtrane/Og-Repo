import { createHash, timingSafeEqual } from "node:crypto";
import { apiError } from "./response";
import type { NextResponse } from "next/server";
import type { ApiErrorBody } from "@/types";

/**
 * Shared-secret authentication for the write side of the API.
 *
 * ## Why this exists
 *
 * `/api/internal/market-data/*` can drive unbounded outbound requests to an
 * upstream publisher and write to the benchmark store. An unauthenticated
 * version of that endpoint on a public URL is somebody else's rate-limit
 * problem waiting to happen, and ours after that.
 *
 * This is **not** a user-account system. There are no users, sessions, roles or
 * password hashes here — just one secret that a scheduler holds and the server
 * checks. That is the right size for machine-to-machine calls, and deliberately
 * too small to grow into an auth system by accident.
 *
 * ## The contract
 *
 * ```
 * Authorization: Bearer <MARKET_INGEST_SECRET>
 * ```
 *
 *  - header missing        → 401
 *  - wrong scheme          → 401
 *  - wrong secret          → 401
 *  - correct secret        → the handler runs
 *  - secret unset **in production** → 401 (fail closed)
 *  - secret unset in development    → allowed, with a warning attached to the
 *    response so it cannot be mistaken for a protected endpoint
 *
 * ## Three rules the implementation keeps
 *
 * 1. **The secret never reaches the browser.** `MARKET_INGEST_SECRET` has no
 *    `NEXT_PUBLIC_` prefix, so Next.js will not inline it into client bundles,
 *    and it is read only from files that run on the server. `tests/auth.test.ts`
 *    asserts both of those mechanically rather than trusting the convention.
 * 2. **The secret is never logged.** Not on success, not on failure, not in an
 *    error message, not in the `details` of an error body. Rejections say what
 *    was wrong with the *request shape* and nothing about the expected value.
 * 3. **Comparison is constant-time.** A naive `===` returns faster the earlier
 *    the first differing byte is, which over enough requests leaks the secret one
 *    character at a time. Both sides are SHA-256'd first so `timingSafeEqual`
 *    gets two equal-length buffers — it throws on a length mismatch, and the
 *    length of the real secret is itself something not worth leaking.
 */

/** Name of the environment variable, in one place so tests can reference it. */
export const INGEST_SECRET_ENV = "MARKET_INGEST_SECRET";

export type IngestAuthOutcome =
  /** Valid secret presented. */
  | "authorised"
  /** No secret configured, and we are not in production — allowed with a warning. */
  | "unprotected"
  /** No `Authorization` header at all. */
  | "missing-credentials"
  /** Header present but not `Bearer <token>`. */
  | "malformed-credentials"
  /** Well-formed header, wrong secret. */
  | "invalid-credentials"
  /** No secret configured in production. Fail closed. */
  | "not-configured";

export interface IngestAuthResult {
  ok: boolean;
  outcome: IngestAuthOutcome;
  /** Safe to return to the caller: describes the request, never the secret. */
  message: string;
}

export interface IngestAuthEnvironment {
  secret: string | undefined;
  /** `production` disables the development escape hatch. */
  nodeEnv: string | undefined;
}

function readEnvironment(): IngestAuthEnvironment {
  return {
    secret: process.env[INGEST_SECRET_ENV],
    nodeEnv: process.env.NODE_ENV,
  };
}

/** Fixed-width digest, so `timingSafeEqual` always gets comparable buffers. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * Pull the token out of an `Authorization` header.
 *
 * Returns `null` for anything that is not exactly one `Bearer` scheme followed
 * by a non-empty token. Being strict here means a caller that sends
 * `Authorization: <secret>` — a common mistake — gets told the scheme is wrong
 * instead of silently failing the comparison and being told the secret is wrong.
 */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Decide whether a request may run an ingest.
 *
 * Takes the environment as an argument so tests can exercise production
 * fail-closed behaviour without mutating `process.env` globally.
 */
export function authoriseIngest(
  request: { headers: { get(name: string): string | null } },
  environment: IngestAuthEnvironment = readEnvironment(),
): IngestAuthResult {
  const { secret, nodeEnv } = environment;
  const configured = typeof secret === "string" && secret.length > 0;

  if (!configured) {
    if (nodeEnv === "production") {
      // Fail closed. An endpoint that writes data and calls out to a third party
      // must not be open because somebody forgot an environment variable — the
      // failure mode of being unavailable is far cheaper than the alternative.
      return {
        ok: false,
        outcome: "not-configured",
        message:
          "This endpoint is not available: ingest authentication is not configured on this server.",
      };
    }
    return {
      ok: true,
      outcome: "unprotected",
      message: `No ${INGEST_SECRET_ENV} is set, so this endpoint is unprotected. That is allowed outside production only. See .env.example.`,
    };
  }

  const header = request.headers.get("authorization");
  if (!header) {
    return {
      ok: false,
      outcome: "missing-credentials",
      message: "Missing Authorization header. Send `Authorization: Bearer <secret>`.",
    };
  }

  const token = extractBearerToken(header);
  if (token === null) {
    return {
      ok: false,
      outcome: "malformed-credentials",
      message:
        "Malformed Authorization header. Expected the Bearer scheme: `Authorization: Bearer <secret>`.",
    };
  }

  if (!secretsMatch(token, secret)) {
    return {
      ok: false,
      outcome: "invalid-credentials",
      message: "Invalid credentials.",
    };
  }

  return { ok: true, outcome: "authorised", message: "Authorised." };
}

/**
 * Route-level guard. Returns a ready-to-return 401 when the caller may not
 * proceed, or `null` when it may.
 *
 * Usage at the top of a handler:
 *
 * ```ts
 * const denied = requireIngestAuth(request);
 * if (denied) return denied;
 * ```
 *
 * `outcome` rides along in the error `details` so an operator wiring up a
 * scheduler can tell "I sent no header" apart from "I sent the wrong secret"
 * apart from "the server has no secret configured" — three problems with three
 * different fixes, none of which reveals the expected value.
 */
export function requireIngestAuth(
  request: { headers: { get(name: string): string | null } },
  environment?: IngestAuthEnvironment,
): NextResponse<ApiErrorBody> | null {
  const result = authoriseIngest(request, environment);
  if (result.ok) return null;
  return apiError("UNAUTHORIZED", result.message, { outcome: result.outcome });
}

/**
 * The warning to surface on a successful response when the endpoint is running
 * unprotected. Returns `null` when a secret is configured, so a protected
 * deployment carries no extra noise.
 */
export function unprotectedWarning(
  request: { headers: { get(name: string): string | null } },
  environment?: IngestAuthEnvironment,
): string | null {
  const result = authoriseIngest(request, environment);
  return result.outcome === "unprotected" ? result.message : null;
}

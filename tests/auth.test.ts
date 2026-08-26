import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  INGEST_SECRET_ENV,
  authoriseIngest,
  extractBearerToken,
  requireIngestAuth,
  unprotectedWarning,
} from "@/lib/api/ingest-auth";

/**
 * Shared-secret authentication on the internal write endpoints.
 *
 * The environment is passed explicitly rather than mutated globally, so the
 * production fail-closed path can be exercised without `NODE_ENV=production`
 * changing the behaviour of every other test in the process.
 */

const SECRET = "s3cr3t-value-that-is-long-enough-to-be-real";

const request = (authorization?: string) => ({
  headers: {
    get: (name: string) =>
      name.toLowerCase() === "authorization" ? (authorization ?? null) : null,
  },
});

const configured = { secret: SECRET, nodeEnv: "production" };
const unconfiguredDev = { secret: undefined, nodeEnv: "development" };
const unconfiguredProd = { secret: undefined, nodeEnv: "production" };

describe("extractBearerToken", () => {
  it("reads a well-formed Bearer header", () => {
    assert.equal(extractBearerToken("Bearer abc123"), "abc123");
  });

  it("tolerates surrounding whitespace and extra spacing", () => {
    assert.equal(extractBearerToken("  Bearer   abc123  "), "abc123");
  });

  it("rejects a bare token with no scheme", () => {
    assert.equal(extractBearerToken("abc123"), null);
  });

  it("rejects another scheme", () => {
    assert.equal(extractBearerToken("Basic abc123"), null);
  });

  it("rejects an empty token", () => {
    assert.equal(extractBearerToken("Bearer "), null);
    assert.equal(extractBearerToken("Bearer"), null);
  });

  it("rejects a missing header", () => {
    assert.equal(extractBearerToken(null), null);
  });
});

describe("authoriseIngest", () => {
  it("accepts the correct secret", () => {
    const result = authoriseIngest(request(`Bearer ${SECRET}`), configured);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "authorised");
  });

  it("rejects a request with no Authorization header", () => {
    const result = authoriseIngest(request(), configured);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "missing-credentials");
  });

  it("rejects a malformed Authorization header", () => {
    const result = authoriseIngest(request(SECRET), configured);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "malformed-credentials");
  });

  it("rejects an incorrect secret", () => {
    const result = authoriseIngest(request("Bearer wrong-value"), configured);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "invalid-credentials");
  });

  it("rejects a secret that is a prefix of the real one", () => {
    // Guards the constant-time comparison: hashing first means differing
    // lengths compare as unequal rather than throwing.
    const result = authoriseIngest(request(`Bearer ${SECRET.slice(0, 10)}`), configured);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "invalid-credentials");
  });

  it("rejects a secret with trailing content", () => {
    const result = authoriseIngest(request(`Bearer ${SECRET}extra`), configured);
    assert.equal(result.ok, false);
  });

  it("fails closed in production when no secret is configured", () => {
    const result = authoriseIngest(request(`Bearer ${SECRET}`), unconfiguredProd);
    assert.equal(result.ok, false, "an unconfigured production endpoint must refuse");
    assert.equal(result.outcome, "not-configured");
  });

  it("fails closed in production even for an unauthenticated caller", () => {
    const result = authoriseIngest(request(), unconfiguredProd);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "not-configured");
  });

  it("treats an empty-string secret as unconfigured", () => {
    const result = authoriseIngest(request("Bearer "), { secret: "", nodeEnv: "production" });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "not-configured");
  });

  it("allows an unprotected endpoint outside production, with a warning", () => {
    const result = authoriseIngest(request(), unconfiguredDev);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, "unprotected");
    assert.match(result.message, /MARKET_INGEST_SECRET/);
  });

  it("never repeats the secret in any rejection message", () => {
    const messages = [
      authoriseIngest(request(), configured).message,
      authoriseIngest(request(SECRET), configured).message,
      authoriseIngest(request("Bearer wrong"), configured).message,
      authoriseIngest(request(`Bearer ${SECRET}`), unconfiguredProd).message,
    ];
    for (const message of messages) {
      assert.ok(!message.includes(SECRET), `leaked the secret: ${message}`);
    }
  });
});

describe("requireIngestAuth", () => {
  it("returns null when the caller may proceed", () => {
    assert.equal(requireIngestAuth(request(`Bearer ${SECRET}`), configured), null);
  });

  it("returns a 401 with a machine-readable outcome and no secret", async () => {
    const response = requireIngestAuth(request("Bearer nope"), configured);
    assert.ok(response, "a response is returned");
    assert.equal(response.status, 401);

    const body = await response.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
    assert.equal(body.error.details.outcome, "invalid-credentials");
    assert.ok(!JSON.stringify(body).includes(SECRET));
  });

  it("returns 401 for a missing header", async () => {
    const response = requireIngestAuth(request(), configured);
    assert.equal(response?.status, 401);
    assert.equal((await response!.json()).error.details.outcome, "missing-credentials");
  });

  it("returns 401 in production when the server has no secret", async () => {
    const response = requireIngestAuth(request(`Bearer ${SECRET}`), unconfiguredProd);
    assert.equal(response?.status, 401);
    assert.equal((await response!.json()).error.details.outcome, "not-configured");
  });
});

describe("unprotectedWarning", () => {
  it("warns when running without a configured secret", () => {
    assert.match(unprotectedWarning(request(), unconfiguredDev) ?? "", /unprotected/);
  });

  it("stays silent when a secret is configured", () => {
    assert.equal(unprotectedWarning(request(`Bearer ${SECRET}`), configured), null);
  });
});

/**
 * The secret must never reach the browser. Two mechanical checks, because a
 * convention that is only written down is a convention that eventually breaks.
 */
describe("the ingest secret stays server-side", () => {
  const root = new URL("..", import.meta.url).pathname;

  function walk(dir: string, files: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".next", ".git", "tests"].includes(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, files);
      else if (/\.(ts|tsx)$/.test(path)) files.push(path);
    }
    return files;
  }

  const sources = walk(root);

  it("is never prefixed with NEXT_PUBLIC_", () => {
    for (const file of sources) {
      const contents = readFileSync(file, "utf8");
      assert.ok(
        !contents.includes(`NEXT_PUBLIC_${INGEST_SECRET_ENV}`),
        `${file} would inline the ingest secret into the client bundle`,
      );
    }
  });

  it("is never read from a client component", () => {
    for (const file of sources) {
      const contents = readFileSync(file, "utf8");
      if (!contents.includes(INGEST_SECRET_ENV)) continue;
      const isClient = /^\s*["']use client["']/m.test(contents);
      assert.ok(!isClient, `${file} is a client component and reads ${INGEST_SECRET_ENV}`);
    }
  });

  it("is documented in .env.example", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    assert.match(example, new RegExp(`^# ${INGEST_SECRET_ENV}=`, "m"));
  });
});

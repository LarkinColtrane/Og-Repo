import type { MarketDataRepository } from "./repository";
import { DemoMarketDataRepository } from "./demo-repository";

export * from "./repository";
export { DemoMarketDataRepository } from "./demo-repository";
export { PostgresMarketDataRepository } from "./postgres-repository";
export type { SqlExecutor } from "./postgres-repository";
export * from "./attribution";

/**
 * The one place that decides where data comes from.
 *
 * Every server component and API route calls `getRepository()`. Today it always
 * returns the demo implementation; connecting PostgreSQL means editing this
 * function and nothing else:
 *
 * ```ts
 * if (process.env.DATABASE_URL) {
 *   return new PostgresMarketDataRepository(createPgExecutor(process.env.DATABASE_URL));
 * }
 * ```
 *
 * The instance is cached per process so a future connection pool is created once
 * rather than per request.
 */
let repository: MarketDataRepository | null = null;

export function getRepository(): MarketDataRepository {
  if (!repository) {
    repository = new DemoMarketDataRepository();
  }
  return repository;
}

/** Test seam: swap in a fake repository, then restore with `resetRepository()`. */
export function setRepository(next: MarketDataRepository): void {
  repository = next;
}

export function resetRepository(): void {
  repository = null;
}

import type { MarketDataRepository } from "./repository";
import { DemoMarketDataRepository } from "./demo-repository";
import type { MortgageRateRepository } from "./mortgage-repository";
import { DemoMortgageRateRepository } from "./demo-mortgage-repository";
import type { MarketBenchmarkRepository } from "./benchmark-repository";
import { DemoMarketBenchmarkRepository } from "./demo-benchmark-repository";
import type { ImportRunStore } from "./import-run-store";
import { InMemoryImportRunStore } from "./import-run-store";
import type { AlertIncidentStore } from "@/lib/pipeline/alerts";
import { InMemoryAlertIncidentStore } from "@/lib/pipeline/alerts";
import type { CivicDataRepository } from "./civic-repository";
import { DemoCivicDataRepository } from "./demo-civic-repository";
import { PostgresMarketDataRepository } from "./postgres-repository";
import { PostgresMortgageRateRepository } from "./postgres-mortgage-repository";
import {
  PostgresImportRunStore,
  PostgresMarketBenchmarkRepository,
} from "./postgres-benchmark-repository";
import { PostgresCivicDataRepository } from "./postgres-civic-repository";
import { PostgresAlertIncidentStore } from "./postgres-alert-store";
import { getSqlExecutor } from "./postgres-client";

/**
 * The switch.
 *
 * Resolved per call rather than cached at module load: tests set and clear the
 * variable between cases, and a value captured at import time would make the
 * first test to run decide the answer for every test after it.
 */
function sql() {
  return getSqlExecutor();
}

/**
 * ## Which datasets `DATABASE_URL` actually switches
 *
 * Not all of them, and that is deliberate.
 *
 * A dataset should read from PostgreSQL when something can *put data there*.
 * Four can:
 *
 *   - **benchmarks** — the Bank of Canada pipeline writes them
 *   - **civic permits** — the Ville de Montréal pipeline writes them
 *   - **import runs** — every pipeline writes them
 *   - **alert incidents** — the monitor writes them
 *
 * Two cannot. There is no importer for neighbourhood prices and rents, and none
 * for lender rates: the licensed feeds those would need are still `planned`.
 * Pointing them at PostgreSQL would connect them to a table that nothing fills.
 *
 * That is not a hypothetical. Wiring all six to `DATABASE_URL` broke the
 * production build the first time it was tried against a real database:
 *
 * ```
 * Error occurred prerendering page "/"
 * Error: No sale statistics on record.
 *   at getLatestPeriod (lib/data/postgres-repository.ts:96)
 * ```
 *
 * — which is precisely the state a new database is in the minute after the
 * migrations run. The first deploy would have failed before serving a request.
 *
 * So the two datasets with no importer stay on the generated fallback, clearly
 * labelled demo, until someone opts them in:
 *
 * ```bash
 * MARKET_DATA_SOURCE=postgres      # once a market importer exists and has run
 * MORTGAGE_RATES_SOURCE=postgres   # once a rate feed is licensed and importing
 * ```
 *
 * This is an opt-in, not a fallback. Nothing switches *back* to demo on its own:
 * once a dataset reads from PostgreSQL, an upstream outage leaves the last
 * stored rows in place and the interface reports them as stale — it never
 * quietly substitutes generated numbers. That rule is what
 * `tests/integration/wiring.test.ts` pins down.
 */
function postgresEnabledFor(dataset: "market" | "rates"): boolean {
  const flag =
    dataset === "market"
      ? process.env.MARKET_DATA_SOURCE
      : process.env.MORTGAGE_RATES_SOURCE;
  return flag === "postgres";
}

export * from "./repository";
export { DemoMarketDataRepository } from "./demo-repository";
export { PostgresMarketDataRepository } from "./postgres-repository";
export type { SqlExecutor } from "./postgres-repository";
export * from "./attribution";
export * from "./mortgage-repository";
export { DemoMortgageRateRepository } from "./demo-mortgage-repository";
export { PostgresMortgageRateRepository } from "./postgres-mortgage-repository";
export * from "./benchmark-repository";
export * from "./import-run-store";
export { DemoMarketBenchmarkRepository } from "./demo-benchmark-repository";
export {
  PostgresMarketBenchmarkRepository,
  PostgresImportRunStore,
} from "./postgres-benchmark-repository";
export * from "./civic-repository";
export { DemoCivicDataRepository } from "./demo-civic-repository";
export { PostgresCivicDataRepository } from "./postgres-civic-repository";
export { PostgresAlertIncidentStore } from "./postgres-alert-store";
export { closePool, getPool, getSqlExecutor } from "./postgres-client";

/** Clear every cached repository. Used by tests that switch DATABASE_URL. */
export function resetAllRepositories(): void {
  resetRepository();
  resetMortgageRateRepository();
  resetBenchmarkRepository();
  resetCivicRepository();
  resetImportRunStore();
  resetAlertIncidentStore();
}

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
    const executor = postgresEnabledFor("market") ? sql() : null;
    repository = executor
      ? new PostgresMarketDataRepository(executor)
      : new DemoMarketDataRepository();
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

/**
 * The one place that decides where mortgage rates come from.
 *
 * Separate from `getRepository()` on purpose: rates and market statistics are
 * different sources with different refresh cadences and different licensing, and
 * they will not become live on the same day. Two factories means either can be
 * switched to a real backing store without touching the other, and each keeps
 * its own `dataQuality` flag.
 *
 * ```ts
 * if (process.env.DATABASE_URL) {
 *   return new PostgresMortgageRateRepository(executeSql);
 * }
 * ```
 */
let mortgageRateRepository: MortgageRateRepository | null = null;

export function getMortgageRateRepository(): MortgageRateRepository {
  if (!mortgageRateRepository) {
    const executor = postgresEnabledFor("rates") ? sql() : null;
    mortgageRateRepository = executor
      ? new PostgresMortgageRateRepository(executor)
      : new DemoMortgageRateRepository();
  }
  return mortgageRateRepository;
}

/** Test seam, mirroring `setRepository`. */
export function setMortgageRateRepository(next: MortgageRateRepository): void {
  mortgageRateRepository = next;
}

export function resetMortgageRateRepository(): void {
  mortgageRateRepository = null;
}

/**
 * The one place that decides where market benchmarks come from.
 *
 * A third factory, matching the third repository. Benchmarks come from open
 * government APIs on a business-daily cadence — a different source class from
 * both monthly market statistics and commercially licensed lender rates — so it
 * switches independently of the other two.
 *
 * ```ts
 * if (process.env.DATABASE_URL) {
 *   return new PostgresMarketBenchmarkRepository(executeSql);
 * }
 * ```
 *
 * Until a database is connected this returns the read-only demo series, which
 * **refuses writes**: an ingest against it fails loudly rather than appearing to
 * succeed into memory that vanishes on restart.
 */
let benchmarkRepository: MarketBenchmarkRepository | null = null;

export function getBenchmarkRepository(): MarketBenchmarkRepository {
  if (!benchmarkRepository) {
    const executor = sql();
    benchmarkRepository = executor
      ? new PostgresMarketBenchmarkRepository(executor)
      : new DemoMarketBenchmarkRepository();
  }
  return benchmarkRepository;
}

export function setBenchmarkRepository(next: MarketBenchmarkRepository): void {
  benchmarkRepository = next;
}

export function resetBenchmarkRepository(): void {
  benchmarkRepository = null;
}

/**
 * The import-run audit trail.
 *
 * One store serves every pipeline — benchmarks now, market statistics and rates
 * when those land. In-memory until a database exists, and the diagnostics
 * endpoint says so rather than letting an audit trail that evaporates on restart
 * pass for one that does not.
 */
let importRunStore: ImportRunStore | null = null;

export function getImportRunStore(): ImportRunStore {
  if (!importRunStore) {
    const executor = sql();
    importRunStore = executor
      ? new PostgresImportRunStore(executor)
      : new InMemoryImportRunStore();
  }
  return importRunStore;
}

export function setImportRunStore(next: ImportRunStore): void {
  importRunStore = next;
}

export function resetImportRunStore(): void {
  importRunStore = null;
}

/**
 * The one place that decides where civic data comes from.
 *
 * A fourth factory, matching the fourth repository. Municipal open data has its
 * own publisher, licence and cadence, and it becomes live on its own day —
 * which is exactly the point. When the Ville de Montréal connector starts
 * importing for real, this factory returns a live repository while the other
 * three still return demo ones, and the API labels each dataset correctly
 * instead of flipping the whole application to "live".
 *
 * ```ts
 * if (process.env.DATABASE_URL) {
 *   return new PostgresCivicDataRepository(executeSql);
 * }
 * ```
 *
 * Until then this returns the generated fallback, which **refuses writes** so an
 * ingest fails loudly rather than pretending to persist.
 */
let civicRepository: CivicDataRepository | null = null;

export function getCivicRepository(): CivicDataRepository {
  if (!civicRepository) {
    const executor = sql();
    civicRepository = executor
      ? new PostgresCivicDataRepository(executor)
      : new DemoCivicDataRepository();
  }
  return civicRepository;
}

export function setCivicRepository(next: CivicDataRepository): void {
  civicRepository = next;
}

export function resetCivicRepository(): void {
  civicRepository = null;
}

/**
 * Open monitoring incidents.
 *
 * A fourth factory, for the same reason as the third: this is pipeline state,
 * not market data, and it becomes durable on a different day from everything
 * else. Until then it is process-local, and `runPipelineMonitor` reports that
 * limitation in its response rather than letting a serverless deployment
 * quietly re-notify the same incident on every invocation.
 */
let alertIncidentStore: AlertIncidentStore | null = null;

export function getAlertIncidentStore(): AlertIncidentStore {
  if (!alertIncidentStore) {
    const executor = sql();
    alertIncidentStore = executor
      ? new PostgresAlertIncidentStore(executor)
      : new InMemoryAlertIncidentStore();
  }
  return alertIncidentStore;
}

export function setAlertIncidentStore(next: AlertIncidentStore): void {
  alertIncidentStore = next;
}

export function resetAlertIncidentStore(): void {
  alertIncidentStore = null;
}

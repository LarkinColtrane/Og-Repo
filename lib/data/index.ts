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
    mortgageRateRepository = new DemoMortgageRateRepository();
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
    benchmarkRepository = new DemoMarketBenchmarkRepository();
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
    importRunStore = new InMemoryImportRunStore();
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
    alertIncidentStore = new InMemoryAlertIncidentStore();
  }
  return alertIncidentStore;
}

export function setAlertIncidentStore(next: AlertIncidentStore): void {
  alertIncidentStore = next;
}

export function resetAlertIncidentStore(): void {
  alertIncidentStore = null;
}

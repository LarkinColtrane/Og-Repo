import type {
  Lender,
  MortgageRate,
  MortgageRateFilter,
} from "@/types/mortgage";

/**
 * The mortgage-rate access contract.
 *
 * Deliberately a **separate interface** from `MarketDataRepository` rather than
 * more methods on it. Rates and market statistics have nothing in common
 * operationally: rates change daily and come from lenders or an aggregator under
 * commercial terms; market statistics change monthly and come from public
 * agencies. Folding them together would mean a rate refresh had to reason about
 * neighbourhoods, and a rate outage would look like a market-data outage.
 *
 * Keeping them apart also means each carries its own `dataQuality` flag, so the
 * app can honestly report live rates against demo market data, or the reverse,
 * as each source is connected.
 *
 * Every method is async even though the demo implementation is synchronous —
 * same reasoning as the market repository: a synchronous interface today would
 * ripple through every caller the day a database appears.
 */
export interface MortgageRateRepository {
  /** Human-readable name for the backing store, shown in the data-sources view. */
  readonly name: string;

  /** `demo` while rates are generated; `live` once a real feed writes them. */
  readonly dataQuality: "demo" | "live";

  listLenders(): Promise<Lender[]>;
  getLender(id: string): Promise<Lender | null>;

  /** Every rate matching the filter, sorted by lender display order. */
  listRates(filter?: MortgageRateFilter): Promise<MortgageRate[]>;

  /**
   * The single rate for one lender, product, term and borrower profile, or null
   * when that combination is not quoted.
   */
  getRate(query: Required<MortgageRateFilter>): Promise<MortgageRate | null>;

  /** The effective date of the most recent rates on record, as `YYYY-MM-DD`. */
  getLatestEffectiveDate(): Promise<string>;
}

/** Thrown when a repository is asked for something it cannot yet provide. */
export class MortgageRateNotAvailableError extends Error {
  constructor(operation: string) {
    super(`This mortgage-rate repository does not implement "${operation}" yet.`);
    this.name = "MortgageRateNotAvailableError";
  }
}

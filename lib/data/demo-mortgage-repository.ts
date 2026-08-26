import type { Lender, MortgageRate, MortgageRateFilter } from "@/types/mortgage";
import { LENDERS, DEMO_RATE_EFFECTIVE_DATE, getDemoRates } from "@/data/demo/lenders";
import type { MortgageRateRepository } from "./mortgage-repository";

/**
 * Repository backed by the generated demo rate table.
 *
 * Reads from memory, but is written the way a database-backed repository is:
 * filtering happens in one place, nothing here knows about React, and the
 * `dataQuality` flag is a property of the store rather than something a component
 * decides. A `PostgresMortgageRateRepository` implementing the same interface
 * drops in beside it.
 */
export class DemoMortgageRateRepository implements MortgageRateRepository {
  readonly name = "In-memory demo rate table";
  readonly dataQuality = "demo" as const;

  private lendersById = new Map<string, Lender>(
    LENDERS.map((lender) => [lender.id, lender]),
  );

  async listLenders(): Promise<Lender[]> {
    return [...LENDERS].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async getLender(id: string): Promise<Lender | null> {
    return this.lendersById.get(id) ?? null;
  }

  async listRates(filter: MortgageRateFilter = {}): Promise<MortgageRate[]> {
    return getDemoRates()
      .filter((rate) => {
        if (filter.lenderId && rate.lenderId !== filter.lenderId) return false;
        if (filter.productType && rate.productType !== filter.productType) return false;
        if (filter.termYears !== undefined && rate.termYears !== filter.termYears) {
          return false;
        }
        if (
          filter.borrowerProfile &&
          rate.borrowerProfile !== filter.borrowerProfile
        ) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          (this.lendersById.get(a.lenderId)?.displayOrder ?? 99) -
          (this.lendersById.get(b.lenderId)?.displayOrder ?? 99),
      );
  }

  async getRate(query: Required<MortgageRateFilter>): Promise<MortgageRate | null> {
    const matches = await this.listRates(query);
    return matches[0] ?? null;
  }

  async getLatestEffectiveDate(): Promise<string> {
    return DEMO_RATE_EFFECTIVE_DATE;
  }
}

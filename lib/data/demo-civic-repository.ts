import type { BoroughPermitStat } from "@/types/civic";
import type { Period } from "@/types";
import type { BoroughCode } from "@/lib/geo/montreal";
import {
  CivicWriteNotSupportedError,
  type CivicDataRepository,
  type PermitStatQuery,
} from "./civic-repository";
import { demoPermitStats } from "@/data/demo/permits";

/**
 * The generated civic dataset, used until a database is connected.
 *
 * **Writes are refused.** An ingest run against this repository fails loudly
 * rather than appearing to succeed into memory that vanishes on restart — the
 * same rule the demo benchmark repository follows, and for the same reason: an
 * import that reports success without persisting anything is worse than one
 * that fails, because the audit trail then says everything is fine.
 */
export class DemoCivicDataRepository implements CivicDataRepository {
  readonly name = "Generated demo civic data (read-only)";
  readonly dataQuality = "demo" as const;

  async getPermitStats(query: PermitStatQuery): Promise<BoroughPermitStat[]> {
    let rows = demoPermitStats().filter(
      (stat) =>
        (!query.boroughCode || stat.boroughCode === query.boroughCode) &&
        (!query.from || stat.period >= query.from) &&
        (!query.to || stat.period <= query.to),
    );

    // A limit takes the *most recent* periods, matching the SQL implementation:
    // slicing from the front would return the oldest, which is never what a
    // caller asking for "the last 12 months" wants.
    if (query.limit !== undefined && rows.length > query.limit) {
      rows = rows.slice(rows.length - query.limit);
    }
    return rows;
  }

  async getLatestPeriod(): Promise<Period | null> {
    const rows = demoPermitStats();
    return rows.length > 0 ? rows[rows.length - 1].period : null;
  }

  async getReportingBoroughs(): Promise<BoroughCode[]> {
    return [...new Set(demoPermitStats().map((stat) => stat.boroughCode))].sort();
  }

  async upsertPermitStats(stats: BoroughPermitStat[]): Promise<number> {
    // The parameter is named and voided rather than dropped so the signature
    // matches the interface and a reader can see it is deliberately unused.
    void stats;
    throw new CivicWriteNotSupportedError(this.name);
  }
}

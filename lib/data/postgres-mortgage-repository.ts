import type { Lender, MortgageRate, MortgageRateFilter } from "@/types/mortgage";
import type { MortgageRateRepository } from "./mortgage-repository";
import type { SqlExecutor } from "./postgres-repository";

/**
 * PostgreSQL / Supabase implementation of the rate repository.
 *
 * ── Status ──────────────────────────────────────────────────────────────
 * **Not wired up.** There is no database in this repository and no driver in
 * package.json. The class exists so the shape of the integration is visible
 * before committing to it — and so the SQL that a rate import has to satisfy is
 * written down somewhere executable rather than described in prose.
 *
 * ── How to turn it on ───────────────────────────────────────────────────
 *  1. Apply `docs/sql/002_mortgage_rates.sql`.
 *  2. Reuse the same `SqlExecutor` the market repository uses — one pool serves
 *     both, since they are two tables in one database, not two systems.
 *  3. Set `DATABASE_URL`; `lib/data/index.ts` picks this over the demo table.
 *
 * The rest of the application is untouched: it depends on
 * `MortgageRateRepository`, not on this class, and the "Demo rate" badge
 * disappears on its own because it reads `dataQuality`.
 *
 * ── One query worth understanding ───────────────────────────────────────
 * `listRates` returns only the **latest** row per
 * (lender, product, term, profile). A rate table is a history — the same lender
 * quotes a new five-year fixed every few weeks — so a naive `SELECT *` would
 * show every rate a lender ever posted. `DISTINCT ON` is the Postgres idiom for
 * "most recent row per group", and it is why the table can keep history without
 * the comparison view having to think about it.
 */
interface LenderRow {
  id: string;
  name: string;
  short_name: string;
  kind: string;
  headquarters: string;
  url: string;
  display_order: number;
}

export class PostgresMortgageRateRepository implements MortgageRateRepository {
  readonly name = "PostgreSQL";
  readonly dataQuality = "live" as const;

  constructor(private readonly query: SqlExecutor) {}

  async listLenders(): Promise<Lender[]> {
    const rows = await this.query<LenderRow>(
      `SELECT id, name, short_name, kind, headquarters, url, display_order
         FROM lenders
        WHERE active
        ORDER BY display_order`,
    );
    return rows.map(toLender);
  }

  async getLender(id: string): Promise<Lender | null> {
    const rows = await this.query<LenderRow>(
      `SELECT id, name, short_name, kind, headquarters, url, display_order
         FROM lenders
        WHERE id = $1`,
      [id],
    );
    return rows[0] ? toLender(rows[0]) : null;
  }

  async listRates(filter: MortgageRateFilter = {}): Promise<MortgageRate[]> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT DISTINCT ON (r.lender_id, r.product_type, r.term_years, r.borrower_profile)
              r.id,
              r.lender_id,
              r.product_type,
              r.term_years,
              r.borrower_profile,
              r.rate,
              to_char(r.effective_date, 'YYYY-MM-DD') AS effective_date,
              r.data_source_id,
              r.data_quality,
              r.updated_at,
              l.display_order
         FROM mortgage_rates r
         JOIN lenders l ON l.id = r.lender_id
        -- product_type and borrower_profile are ENUM columns. Comparing one to
        -- a text parameter raises "operator does not exist:
        -- mortgage_product_type = text", so the PARAMETER is cast to the enum
        -- rather than the column to text -- casting the column would defeat any
        -- index on it.
        WHERE ($1::text IS NULL OR r.lender_id = $1)
          AND ($2::text IS NULL OR r.product_type = $2::mortgage_product_type)
          AND ($3::int  IS NULL OR r.term_years = $3)
          AND ($4::text IS NULL OR r.borrower_profile = $4::borrower_profile)
          AND l.active
        ORDER BY r.lender_id, r.product_type, r.term_years, r.borrower_profile,
                 r.effective_date DESC`,
      [
        filter.lenderId ?? null,
        filter.productType ?? null,
        filter.termYears ?? null,
        filter.borrowerProfile ?? null,
      ],
    );

    // `DISTINCT ON` dictates the ORDER BY, so display order has to be applied
    // afterwards. The lookup is built once rather than scanned per comparison.
    const orderByLender = new Map(
      rows.map((row) => [String(row.lender_id), Number(row.display_order ?? 99)]),
    );

    return rows
      .map(toMortgageRate)
      .sort(
        (a, b) =>
          (orderByLender.get(a.lenderId) ?? 99) - (orderByLender.get(b.lenderId) ?? 99),
      );
  }

  async getRate(query: Required<MortgageRateFilter>): Promise<MortgageRate | null> {
    const matches = await this.listRates(query);
    return matches[0] ?? null;
  }

  async getLatestEffectiveDate(): Promise<string> {
    const rows = await this.query<{ effective_date: string }>(
      `SELECT to_char(max(effective_date), 'YYYY-MM-DD') AS effective_date
         FROM mortgage_rates`,
    );
    const date = rows[0]?.effective_date;
    if (!date) throw new Error("No mortgage rates on record.");
    return date;
  }
}

function toLender(row: LenderRow): Lender {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    kind: row.kind as Lender["kind"],
    headquarters: row.headquarters,
    url: row.url,
    displayOrder: Number(row.display_order),
  };
}

function toMortgageRate(row: Record<string, unknown>): MortgageRate {
  return {
    id: String(row.id),
    lenderId: String(row.lender_id),
    productType: row.product_type as MortgageRate["productType"],
    termYears: Number(row.term_years),
    borrowerProfile: row.borrower_profile as MortgageRate["borrowerProfile"],
    rate: Number(row.rate),
    effectiveDate: String(row.effective_date),
    dataSourceId: String(row.data_source_id),
    dataQuality: row.data_quality as MortgageRate["dataQuality"],
    lastUpdated: new Date(String(row.updated_at)).toISOString(),
  };
}

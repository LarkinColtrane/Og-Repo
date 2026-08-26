"use client";

import type { FinancingMatrix } from "@/lib/calculations/financing";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent, formatRate } from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RowHeader, Table, TableWrapper, Td, Th } from "@/components/ui/data-table";

/**
 * Lenders down the rows, down-payment levels across the columns.
 *
 * The point of the grid is to make leverage legible at a glance: reading across
 * a row shows what a larger down payment does to the payment, and reading down a
 * column shows how little separates the lenders by comparison. That second
 * observation is usually the more useful one.
 *
 * Eligibility is a property of the buyer and the property, not of the lender, so
 * a blocked level is blocked in every row. The column is still drawn, with the
 * reason stated once beneath the table rather than repeated in seven cells.
 */
export function FinancingMatrixPanel({
  matrix,
  selectedPercent,
}: {
  matrix: FinancingMatrix;
  /** Highlighted so the reader can see which column the analysis is using. */
  selectedPercent: number;
}) {
  return (
    <Card>
      <CardHeader
        title={copy.financing.matrixTitle}
        description={copy.financing.matrixSubtitle}
      />
      <CardBody>
        <TableWrapper label={copy.financing.matrixTitle}>
          <Table>
            <thead>
              <tr>
                <Th sticky>Lender</Th>
                {matrix.downPaymentPercents.map((percent) => (
                  <Th
                    key={percent}
                    numeric
                    className={cn(
                      Math.abs(percent - selectedPercent) < 0.001 && "text-accent",
                    )}
                  >
                    {formatPercent(percent, 0)} down
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.lender.id}>
                  <RowHeader>{row.lender.shortName}</RowHeader>
                  {row.cells.map((cell) => (
                    <Td
                      key={`${row.lender.id}-${cell.downPaymentPercent}`}
                      numeric
                      className={cn(
                        Math.abs(cell.downPaymentPercent - selectedPercent) < 0.001 &&
                          "bg-accent-soft",
                      )}
                    >
                      {cell.eligible && cell.monthlyPayment !== null ? (
                        <>
                          <span className="block font-medium text-ink">
                            {formatCurrency(cell.monthlyPayment)}
                            <span className="text-[0.6875rem] font-normal text-ink-muted">
                              {copy.financing.perMonth}
                            </span>
                          </span>
                          <span className="block text-[0.6875rem] font-normal text-ink-muted">
                            {formatRate(cell.rate)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[0.75rem] font-normal text-ink-muted">
                          {copy.financing.notEligible}
                        </span>
                      )}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrapper>

        {matrix.unavailableLevels.length > 0 ? (
          <div className="mt-4 space-y-1.5 border-t border-line pt-3">
            <p className="eyebrow">{copy.financing.whyNotEligible}</p>
            {matrix.unavailableLevels.map((level) => (
              <p
                key={level.downPaymentPercent}
                className="text-[0.75rem] leading-relaxed text-ink-secondary"
              >
                <span className="font-semibold text-ink">
                  {formatPercent(level.downPaymentPercent, 0)} down —
                </span>{" "}
                {level.reason}
              </p>
            ))}
          </div>
        ) : null}

        <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-muted">
          Payments use each lender&rsquo;s demo rate for the borrower profile the
          level implies — insured pricing below 20% down, conventional at or above
          it. That is why a smaller down payment can carry a lower rate and a
          larger payment at the same time.
        </p>
      </CardBody>
    </Card>
  );
}

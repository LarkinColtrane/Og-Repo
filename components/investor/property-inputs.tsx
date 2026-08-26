"use client";

import type { PropertyType } from "@/types";
import { PROPERTY_TYPES } from "@/types";
import type { MortgageProductType, OccupancyType } from "@/types/mortgage";
import { FIXED_TERMS, VARIABLE_TERMS } from "@/types/mortgage";
import { copy } from "@/lib/i18n";
import { formatCurrency, formatPercent } from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NumberField, RangeField } from "@/components/ui/number-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import type { FinancingFormState } from "./financing-state";

/**
 * Every input the financing analysis depends on, in one panel.
 *
 * Grouped by what the reader is thinking about — the property, then the loan,
 * then what it costs to run — rather than by which calculation consumes each
 * field. A form organised around the code is faster to write and slower to use.
 */
export function PropertyInputs({
  value,
  onChange,
  onReset,
  description,
}: {
  value: FinancingFormState;
  onChange: <K extends keyof FinancingFormState>(
    key: K,
    next: FinancingFormState[K],
  ) => void;
  onReset: () => void;
  description?: string;
}) {
  const isCondo = value.propertyType === "condo";
  const terms = value.productType === "fixed" ? FIXED_TERMS : VARIABLE_TERMS;

  return (
    <Card>
      <CardHeader
        title={copy.financing.propertyTitle}
        description={description ?? copy.financing.propertySubtitle}
        actions={
          <Button size="sm" variant="ghost" onClick={onReset}>
            {copy.actions.reset}
          </Button>
        }
      />
      <CardBody className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label={copy.calculator.purchasePrice}
            value={value.purchasePrice}
            onChange={(next) => onChange("purchasePrice", next)}
            prefix="$"
            step={5000}
          />
          <NumberField
            label={copy.financing.rentalIncome}
            value={value.monthlyRent}
            onChange={(next) => onChange("monthlyRent", next)}
            prefix="$"
            step={25}
            hint="Total for all units, at full occupancy."
          />
          <NumberField
            label={copy.financing.units}
            value={value.units}
            onChange={(next) => onChange("units", Math.max(1, Math.round(next)))}
            step={1}
            min={1}
            max={12}
            hint={copy.financing.unitsHint}
          />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-4 border-t border-line pt-5">
          <Field label="Property type">
            <SegmentedControl
              size="sm"
              label="Property type"
              value={value.propertyType}
              onChange={(next) => onChange("propertyType", next as PropertyType)}
              options={PROPERTY_TYPES.map((type) => ({
                value: type,
                label: copy.propertyTypes[type],
              }))}
            />
          </Field>

          <Field label="Occupancy">
            <SegmentedControl
              size="sm"
              label="Occupancy"
              value={value.occupancy}
              onChange={(next) => onChange("occupancy", next as OccupancyType)}
              options={[
                { value: "owner-occupied", label: copy.financing.ownerOccupied },
                { value: "investment", label: copy.financing.investmentOnly },
              ]}
            />
          </Field>

          <Field label={copy.financing.productType}>
            <SegmentedControl
              size="sm"
              label={copy.financing.productType}
              value={value.productType}
              onChange={(next) =>
                onChange("productType", next as MortgageProductType)
              }
              options={[
                { value: "fixed", label: copy.financing.fixed },
                { value: "variable", label: copy.financing.variable },
              ]}
            />
          </Field>

          <Field label={copy.financing.term} hint={copy.financing.termHint}>
            <SegmentedControl
              size="sm"
              label={copy.financing.term}
              value={String(value.termYears)}
              onChange={(next) => onChange("termYears", Number(next))}
              options={terms.map((term) => ({
                value: String(term),
                label: `${term}y`,
              }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 border-t border-line pt-5 sm:grid-cols-2">
          <RangeField
            label={`${copy.calculator.amortization} — ${value.amortizationYears} ${copy.calculator.years}`}
            value={value.amortizationYears}
            onChange={(next) => onChange("amortizationYears", next)}
            min={5}
            max={30}
            step={5}
            format={(next) => `${next} ${copy.calculator.years}`}
          />
          <RangeField
            label={copy.calculator.vacancyAllowance}
            value={value.vacancyAllowancePercent}
            onChange={(next) => onChange("vacancyAllowancePercent", next)}
            min={0}
            max={15}
            step={0.5}
            format={(next) => formatPercent(next)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label={copy.financing.municipalTaxes}
            value={value.municipalTaxes}
            onChange={(next) => onChange("municipalTaxes", next)}
            prefix="$"
            step={100}
            hint="Annual."
          />
          <NumberField
            label={copy.financing.schoolTaxes}
            value={value.schoolTaxes}
            onChange={(next) => onChange("schoolTaxes", next)}
            prefix="$"
            step={50}
            hint="Annual. Québec bills these separately."
          />
          <NumberField
            label={copy.calculator.insurance}
            value={value.annualInsurance}
            onChange={(next) => onChange("annualInsurance", next)}
            prefix="$"
            step={50}
            hint="Annual."
          />
          <NumberField
            label={copy.calculator.maintenance}
            value={value.annualMaintenance}
            onChange={(next) => onChange("annualMaintenance", next)}
            prefix="$"
            step={100}
            hint="Annual."
          />
          <NumberField
            label={copy.calculator.condoFees}
            value={value.monthlyCondoFees}
            onChange={(next) => onChange("monthlyCondoFees", next)}
            prefix="$"
            step={25}
            hint={isCondo ? "Monthly." : "Monthly. Usually zero outside a condo."}
          />
          <NumberField
            label={copy.financing.otherExpenses}
            value={value.otherMonthlyExpenses}
            onChange={(next) => onChange("otherMonthlyExpenses", next)}
            prefix="$"
            step={25}
            hint="Snow removal, caretaker, accounting."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <NumberField
            label={copy.calculator.closingCosts}
            value={value.closingCosts}
            onChange={(next) => onChange("closingCosts", next)}
            prefix="$"
            step={500}
            hint={`Transfer duty, notary, inspection. Estimated at ${formatCurrency(value.closingCosts)} for this price.`}
          />
          <RangeField
            label={copy.calculator.managementFee}
            value={value.managementFeePercent}
            onChange={(next) => onChange("managementFeePercent", next)}
            min={0}
            max={12}
            step={0.5}
            format={(next) => formatPercent(next)}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{label}</p>
      {children}
      {hint ? (
        <p className="mt-1.5 max-w-[18rem] text-[0.6875rem] leading-snug text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

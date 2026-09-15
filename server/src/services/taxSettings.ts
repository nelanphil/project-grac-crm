import {
  TAX_SETTINGS_SLUG,
  TaxSettings,
} from "../models/mongo/TaxSettings";

export const DEFAULT_TAX_RATE_PERCENT = 0;

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function normalizeTaxRatePercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, Math.round(n * 10000) / 10000);
}

export function computeTaxAmount(
  taxable: number,
  ratePercent: number,
): number {
  return roundMoney(
    (roundMoney(taxable) * normalizeTaxRatePercent(ratePercent)) / 100,
  );
}

export async function getTaxRatePercent(): Promise<number> {
  const doc = await TaxSettings.findOne({ slug: TAX_SETTINGS_SLUG })
    .select("ratePercent")
    .lean();
  return normalizeTaxRatePercent(doc?.ratePercent ?? DEFAULT_TAX_RATE_PERCENT);
}

export function taxCentsFromDollars(amount: number): number {
  return Math.max(0, Math.round(roundMoney(amount) * 100));
}

export function snapshotDocumentTax(input: {
  taxRatePercent?: number | null;
  taxDollars?: number | null;
  taxCents?: number | null;
  taxOverridden?: boolean | null;
}): {
  taxRatePercent: number;
  taxCents: number;
  taxOverridden: boolean;
} {
  const taxRatePercent = normalizeTaxRatePercent(input.taxRatePercent);
  const taxCents =
    input.taxCents != null && Number.isFinite(input.taxCents)
      ? Math.max(0, Math.round(input.taxCents))
      : taxCentsFromDollars(input.taxDollars ?? 0);
  return {
    taxRatePercent,
    taxCents,
    taxOverridden: Boolean(input.taxOverridden),
  };
}

export function applyTaxToPreTaxCents(
  preTaxCents: number,
  tax: { taxRatePercent: number; taxCents: number },
): number {
  return Math.max(0, Math.round(preTaxCents) + tax.taxCents);
}

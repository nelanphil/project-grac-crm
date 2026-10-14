import { Invoice } from "../models/mongo/Invoice";
import {
  TAX_SETTINGS_SLUG,
  TaxSettings,
} from "../models/mongo/TaxSettings";
import { WorkOrder } from "../models/mongo/WorkOrder";

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

/** Tax-inclusive total minus snapshotted tax. Used as the percent-discount base. */
export function preTaxCents(amountCents: number, taxCents = 0): number {
  return Math.max(
    Math.round(Number(amountCents) || 0) - Math.round(Number(taxCents) || 0),
    0,
  );
}

/** Invoices that can still be collected. Paid and void stay at the amount processed. */
export const UNPAID_INVOICE_STATUSES = ["draft", "open", "failed"] as const;

export type CompanyTaxWorkOrderInput = {
  paid?: boolean | null;
  taxOverridden?: boolean | null;
  subtotal?: number | null;
  shipping?: number | null;
  taxRate?: number | null;
  tax?: number | null;
  total?: number | null;
};

export type CompanyTaxInvoiceInput = {
  status: string;
  taxOverridden?: boolean | null;
  amountCents?: number | null;
  originalAmountCents?: number | null;
  discountCents?: number | null;
  taxCents?: number | null;
  taxRatePercent?: number | null;
  /** Set for work-order invoices. Tax is computed on subtotal; shipping is not taxed. */
  workOrder?: CompanyTaxWorkOrderInput | null;
};

export type CompanyTaxInvoiceUpdate = {
  taxRatePercent: number;
  taxCents: number;
  amountCents: number;
  /** Set only when the invoice already stores a pre-discount total. */
  originalAmountCents?: number;
  workOrder?: {
    taxRate: number;
    tax: number;
    total: number;
  };
};

export function invoiceEligibleForCompanyTaxRate(
  input: Pick<CompanyTaxInvoiceInput, "status" | "taxOverridden" | "workOrder">,
): boolean {
  if (
    !(UNPAID_INVOICE_STATUSES as readonly string[]).includes(input.status)
  ) {
    return false;
  }
  if (input.taxOverridden) return false;
  if (input.workOrder?.taxOverridden) return false;
  // A paid work order is about to mark its open invoice paid at the current total.
  if (input.workOrder?.paid) return false;
  return true;
}

function applyDiscountToTotal(
  nextTotalCents: number,
  input: Pick<CompanyTaxInvoiceInput, "originalAmountCents" | "discountCents">,
): { amountCents: number; originalAmountCents?: number } {
  if (typeof input.originalAmountCents === "number") {
    const discountCents = Math.max(0, Math.round(Number(input.discountCents) || 0));
    return {
      originalAmountCents: nextTotalCents,
      amountCents: Math.max(nextTotalCents - discountCents, 0),
    };
  }
  return { amountCents: nextTotalCents };
}

/**
 * Recalculate an unpaid invoice (and its unpaid work order) for a new company
 * rate. Returns null when the invoice is not eligible or already matches.
 */
export function recomputeUnpaidInvoiceTax(
  input: CompanyTaxInvoiceInput,
  nextRatePercent: number,
): CompanyTaxInvoiceUpdate | null {
  if (!invoiceEligibleForCompanyTaxRate(input)) return null;

  const rate = normalizeTaxRatePercent(nextRatePercent);
  const currentTaxCents = Math.max(0, Math.round(Number(input.taxCents) || 0));
  const workOrder = input.workOrder;

  let taxCents: number;
  let nextTotalCents: number;
  let workOrderUpdate: CompanyTaxInvoiceUpdate["workOrder"];

  if (workOrder) {
    const subtotal = roundMoney(Number(workOrder.subtotal) || 0);
    const shipping = roundMoney(Number(workOrder.shipping) || 0);
    const tax = computeTaxAmount(subtotal, rate);
    const total = roundMoney(subtotal + shipping + tax);
    taxCents = taxCentsFromDollars(tax);
    nextTotalCents = taxCentsFromDollars(subtotal + shipping) + taxCents;
    const taxRateChanged = normalizeTaxRatePercent(workOrder.taxRate) !== rate;
    const taxChanged = roundMoney(Number(workOrder.tax) || 0) !== tax;
    const totalChanged = roundMoney(Number(workOrder.total) || 0) !== total;
    if (taxRateChanged || taxChanged || totalChanged) {
      workOrderUpdate = { taxRate: rate, tax, total };
    }
  } else {
    const currentTotal =
      typeof input.originalAmountCents === "number"
        ? input.originalAmountCents
        : Math.round(Number(input.amountCents) || 0);
    const taxableCents = Math.max(currentTotal - currentTaxCents, 0);
    taxCents = taxCentsFromDollars(
      computeTaxAmount(taxableCents / 100, rate),
    );
    nextTotalCents = taxableCents + taxCents;
  }

  const amounts = applyDiscountToTotal(nextTotalCents, input);
  const rateChanged = normalizeTaxRatePercent(input.taxRatePercent) !== rate;
  const taxChanged = currentTaxCents !== taxCents;
  const amountChanged =
    Math.round(Number(input.amountCents) || 0) !== amounts.amountCents;
  const originalChanged =
    typeof amounts.originalAmountCents === "number" &&
    amounts.originalAmountCents !== input.originalAmountCents;
  const invoiceChanged =
    rateChanged || taxChanged || amountChanged || originalChanged;

  if (!invoiceChanged && !workOrderUpdate) return null;

  return {
    taxRatePercent: rate,
    taxCents,
    amountCents: amounts.amountCents,
    ...(typeof amounts.originalAmountCents === "number"
      ? { originalAmountCents: amounts.originalAmountCents }
      : {}),
    ...(workOrderUpdate ? { workOrder: workOrderUpdate } : {}),
  };
}

/** Rewrite unpaid invoices that follow the company rate. Returns how many invoices changed. */
export async function applyCompanyTaxRateToUnpaidInvoices(
  ratePercent: number,
): Promise<number> {
  const rate = normalizeTaxRatePercent(ratePercent);
  const invoices = await Invoice.find({
    status: { $in: [...UNPAID_INVOICE_STATUSES] },
    taxOverridden: { $ne: true },
  });
  if (invoices.length === 0) return 0;

  const workOrderIds = invoices
    .map((invoice) => invoice.workOrderRef)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));
  const workOrders =
    workOrderIds.length > 0
      ? await WorkOrder.find({ _id: { $in: workOrderIds } })
      : [];
  const workOrderById = new Map(
    workOrders.map((workOrder) => [String(workOrder._id), workOrder]),
  );

  let updated = 0;
  const savedWorkOrders = new Set<string>();

  for (const invoice of invoices) {
    const workOrder = invoice.workOrderRef
      ? workOrderById.get(String(invoice.workOrderRef))
      : undefined;
    const next = recomputeUnpaidInvoiceTax(
      {
        status: invoice.status,
        taxOverridden: invoice.taxOverridden,
        amountCents: invoice.amountCents,
        originalAmountCents: invoice.originalAmountCents,
        discountCents: invoice.discountCents,
        taxCents: invoice.taxCents,
        taxRatePercent: invoice.taxRatePercent,
        workOrder: workOrder
          ? {
              paid: workOrder.paid,
              taxOverridden: workOrder.taxOverridden,
              subtotal: workOrder.subtotal,
              shipping: workOrder.shipping,
              taxRate: workOrder.taxRate,
              tax: workOrder.tax,
              total: workOrder.total,
            }
          : null,
      },
      rate,
    );
    if (!next) continue;

    const invoiceChanged =
      normalizeTaxRatePercent(invoice.taxRatePercent) !== next.taxRatePercent ||
      (Number(invoice.taxCents) || 0) !== next.taxCents ||
      invoice.amountCents !== next.amountCents ||
      (typeof next.originalAmountCents === "number" &&
        next.originalAmountCents !== invoice.originalAmountCents);

    if (invoiceChanged) {
      invoice.taxRatePercent = next.taxRatePercent;
      invoice.taxCents = next.taxCents;
      invoice.amountCents = next.amountCents;
      if (typeof next.originalAmountCents === "number") {
        invoice.originalAmountCents = next.originalAmountCents;
      }
      await invoice.save();
      updated += 1;
    }

    if (
      next.workOrder &&
      workOrder &&
      !workOrder.paid &&
      !savedWorkOrders.has(String(workOrder._id))
    ) {
      workOrder.taxRate = next.workOrder.taxRate;
      workOrder.tax = next.workOrder.tax;
      workOrder.total = next.workOrder.total;
      workOrder.taxOverridden = false;
      await workOrder.save();
      savedWorkOrders.add(String(workOrder._id));
    }
  }

  return updated;
}

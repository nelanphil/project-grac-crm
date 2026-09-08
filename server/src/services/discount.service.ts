import { Types } from "mongoose";
import {
  DiscountAppliesTo,
  DiscountCode,
  IDiscountCode,
} from "../models/mongo/DiscountCode";
import { DiscountRedemption } from "../models/mongo/DiscountRedemption";
import { Invoice, IInvoice } from "../models/mongo/Invoice";

export const PENDING_REDEMPTION_TTL_MS = 24 * 60 * 60 * 1000;

export class DiscountError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "DiscountError";
  }
}

export type DiscountQuoteItem = {
  amountCents: number;
  sourceType: string;
};

export type DiscountQuote = {
  code: string;
  label: string;
  mode: "percent" | "amount";
  discountCents: number;
  subtotalCents: number;
  eligibleCents: number;
  totalCents: number;
  discountCodeId: string;
};

export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}

export function appliesToForSource(
  sourceType: string,
): DiscountAppliesTo {
  return sourceType === "work_order" ? "work_order" : "contract";
}

export function isItemEligible(
  code: Pick<IDiscountCode, "appliesTo">,
  sourceType: string,
): boolean {
  if (!code.appliesTo || code.appliesTo.length === 0) return true;
  return code.appliesTo.includes(appliesToForSource(sourceType));
}

export function computeDiscountCents(
  code: Pick<IDiscountCode, "mode" | "value">,
  eligibleCents: number,
): number {
  if (eligibleCents <= 0) return 0;
  const raw =
    code.mode === "percent"
      ? Math.floor((eligibleCents * code.value) / 100)
      : code.value;
  return Math.min(Math.max(raw, 0), eligibleCents);
}

export function allocateDiscount(
  invoices: Array<{ id: string; amountCents: number; eligible: boolean }>,
  discountCents: number,
): Map<string, number> {
  const eligible = invoices.filter((invoice) => invoice.eligible);
  const eligibleTotal = eligible.reduce(
    (sum, invoice) => sum + invoice.amountCents,
    0,
  );
  const alloc = new Map<string, number>();
  if (eligible.length === 0 || eligibleTotal <= 0 || discountCents <= 0) {
    return alloc;
  }

  let remaining = discountCents;
  eligible.forEach((invoice, index) => {
    if (index === eligible.length - 1) {
      alloc.set(invoice.id, remaining);
      return;
    }
    const share = Math.floor(
      (invoice.amountCents / eligibleTotal) * discountCents,
    );
    alloc.set(invoice.id, share);
    remaining -= share;
  });
  return alloc;
}

async function loadActiveCode(rawCode: string): Promise<IDiscountCode> {
  const code = normalizeDiscountCode(rawCode);
  if (!code) {
    throw new DiscountError("Invalid or expired discount code", 400);
  }
  const doc = await DiscountCode.findOne({ code });
  if (!doc || !doc.active) {
    throw new DiscountError("Invalid or expired discount code", 400);
  }
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    throw new DiscountError("Invalid or expired discount code", 400);
  }
  return doc;
}

async function assertRedemptionAvailable(
  doc: IDiscountCode,
  customerRef: string | null,
): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_REDEMPTION_TTL_MS);
  const pendingGlobal = await DiscountRedemption.countDocuments({
    discountCodeRef: doc._id,
    status: "pending",
    createdAt: { $gte: cutoff },
  });
  if (
    doc.maxRedemptions != null &&
    doc.redemptionCount + pendingGlobal >= doc.maxRedemptions
  ) {
    throw new DiscountError("This code has reached its usage limit", 400);
  }

  if (doc.maxRedemptionsPerCustomer == null || !customerRef) return;
  if (!Types.ObjectId.isValid(customerRef)) return;

  const [redeemedCustomer, pendingCustomer] = await Promise.all([
    DiscountRedemption.countDocuments({
      discountCodeRef: doc._id,
      customerRef,
      status: "redeemed",
    }),
    DiscountRedemption.countDocuments({
      discountCodeRef: doc._id,
      customerRef,
      status: "pending",
      createdAt: { $gte: cutoff },
    }),
  ]);
  if (
    redeemedCustomer + pendingCustomer >= doc.maxRedemptionsPerCustomer
  ) {
    throw new DiscountError("This code has already been used", 400);
  }
}

export async function quoteDiscount(input: {
  code: string;
  customerRef: string | null;
  items: DiscountQuoteItem[];
}): Promise<DiscountQuote> {
  const doc = await loadActiveCode(input.code);
  const subtotalCents = input.items.reduce(
    (sum, item) => sum + (item.amountCents || 0),
    0,
  );
  const eligible = input.items.filter((item) =>
    isItemEligible(doc, item.sourceType),
  );
  const eligibleCents = eligible.reduce(
    (sum, item) => sum + (item.amountCents || 0),
    0,
  );
  if (eligible.length === 0 || eligibleCents <= 0) {
    throw new DiscountError(
      "This code does not apply to the selected items",
      400,
    );
  }
  if (doc.minSubtotalCents != null && eligibleCents < doc.minSubtotalCents) {
    throw new DiscountError(
      "This code does not meet the minimum order amount",
      400,
    );
  }

  await assertRedemptionAvailable(doc, input.customerRef);

  const discountCents = computeDiscountCents(doc, eligibleCents);
  return {
    code: doc.code,
    label: doc.label,
    mode: doc.mode,
    discountCents,
    subtotalCents,
    eligibleCents,
    totalCents: Math.max(subtotalCents - discountCents, 0),
    discountCodeId: String(doc._id),
  };
}

export async function createPendingRedemption(input: {
  quote: DiscountQuote;
  customerRef: string;
  invoices: IInvoice[];
}): Promise<void> {
  if (!Types.ObjectId.isValid(input.customerRef)) {
    throw new DiscountError("Invalid customer", 400);
  }

  await DiscountRedemption.updateMany(
    {
      discountCodeRef: input.quote.discountCodeId,
      customerRef: input.customerRef,
      status: "pending",
    },
    { $set: { status: "released" } },
  );

  const codeDoc = await DiscountCode.findById(input.quote.discountCodeId).lean();
  const appliesTo = codeDoc?.appliesTo ?? [];
  const allocMap = allocateDiscount(
    input.invoices.map((invoice) => ({
      id: String(invoice._id),
      amountCents: invoice.amountCents || 0,
      eligible: isItemEligible({ appliesTo }, invoice.sourceType),
    })),
    input.quote.discountCents,
  );

  const allocations = input.invoices
    .map((invoice) => ({
      invoiceRef: invoice._id as Types.ObjectId,
      discountCents: allocMap.get(String(invoice._id)) ?? 0,
    }))
    .filter((row) => row.discountCents > 0);

  await DiscountRedemption.create({
    discountCodeRef: input.quote.discountCodeId,
    code: input.quote.code,
    customerRef: input.customerRef,
    invoiceRefs: input.invoices.map((invoice) => invoice._id),
    allocations,
    discountCents: input.quote.discountCents,
    subtotalCents: input.quote.subtotalCents,
    status: "pending",
  });
}

export async function finalizeRedemptionsForInvoices(
  invoiceIds: string[],
): Promise<void> {
  const unique = [
    ...new Set(invoiceIds.filter((id) => Types.ObjectId.isValid(id))),
  ];
  if (unique.length === 0) return;

  const objectIds = unique.map((id) => new Types.ObjectId(id));
  const pending = await DiscountRedemption.find({
    invoiceRefs: { $in: objectIds },
    status: "pending",
  });
  if (pending.length === 0) return;

  for (const redemption of pending) {
    for (const allocation of redemption.allocations) {
      const invoice = await Invoice.findById(allocation.invoiceRef);
      if (!invoice) continue;
      if (!invoice.originalAmountCents) {
        invoice.originalAmountCents = invoice.amountCents;
      }
      invoice.discountCode = redemption.code;
      invoice.discountCents = allocation.discountCents;
      await invoice.save();
    }

    redemption.status = "redeemed";
    await redemption.save();
    await DiscountCode.updateOne(
      { _id: redemption.discountCodeRef },
      { $inc: { redemptionCount: 1 } },
    );
  }
}

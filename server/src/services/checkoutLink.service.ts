import { randomBytes } from "crypto";
import { Types } from "mongoose";
import { CheckoutLink, type CheckoutLinkItem } from "../models/mongo/CheckoutLink";
import { Invoice } from "../models/mongo/Invoice";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { hashPayToken } from "../utils/payToken";
import { buildCheckoutUrl } from "../utils/checkoutKey";
import {
  CHANGED_CHECKOUT_MESSAGE,
  checkoutScopeMatches,
  checkoutSelectionAllowed,
} from "../utils/checkoutLinkScope";
import {
  CheckoutError,
  listPayableCart,
  listPaymentLinkCart,
  type PublicCheckoutCart,
} from "./checkout.service";

const LINK_PREFIX = "q_";

export async function validateInvoiceMessage(input: {
  invoiceId?: string | null;
  contactIds: string[];
  expectedAmountCents?: number;
}): Promise<void> {
  if (!input.invoiceId) return;
  if (!Types.ObjectId.isValid(input.invoiceId)) throw new CheckoutError("Invalid invoice", 400);
  const invoice = await Invoice.findById(input.invoiceId).lean();
  if (!invoice?.customerRef) throw new CheckoutError("Invoice not found", 404);
  const contacts = await CustomerContact.find({
    _id: { $in: input.contactIds },
  }).select("customerRef").lean();
  if (contacts.length !== new Set(input.contactIds).size ||
      contacts.some((contact) => String(contact.customerRef) !== String(invoice.customerRef))) {
    throw new CheckoutError("Invoice does not belong to the selected customer.", 400);
  }

  if (input.expectedAmountCents !== undefined && input.expectedAmountCents !== invoice.amountCents) {
    throw new CheckoutError(CHANGED_CHECKOUT_MESSAGE, 409);
  }
}

export async function previewPaymentSummary(
  customerId: string,
  invoiceId?: string,
): Promise<string> {
  const cart = invoiceId
    ? await listPayableCart([customerId])
    : await listPaymentLinkCart([customerId]);
  const items = invoiceId
    ? cart.items.filter((item) => item.kind === "invoice" && item.id === invoiceId)
    : cart.items;
  if (invoiceId && items.length !== 1) {
    throw new CheckoutError("Invoice is not payable by this customer", 400);
  }
  return items.length > 0
    ? paymentAmountLabel(items.reduce((sum, item) => sum + item.amountCents, 0), Boolean(invoiceId))
    : "";
}

export function isScopedCheckoutKey(key: string): boolean {
  return /^q_[A-Za-z0-9_-]{24}$/.test(key);
}

export async function createScopedPaymentLink(
  customerId: string,
  options?: { invoiceId?: string | null; expectedAmountCents?: number },
): Promise<{ payUrl: string; invoiceId: string; totalCents: number } | null> {
  const invoiceId = options?.invoiceId;
  const cart = invoiceId
    ? await listPayableCart([customerId])
    : await listPaymentLinkCart([customerId]);
  const items = invoiceId
    ? cart.items.filter((item) => item.kind === "invoice" && item.id === invoiceId)
    : cart.items;
  if (invoiceId && items.length !== 1) {
    throw new CheckoutError("Invoice is not payable by this customer", 400);
  }
  if (items.length === 0) return null;
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  if (options?.expectedAmountCents !== undefined &&
      totalCents !== options.expectedAmountCents) {
    throw new CheckoutError(CHANGED_CHECKOUT_MESSAGE, 409);
  }
  const key = LINK_PREFIX + randomBytes(18).toString("base64url");
  await CheckoutLink.create({
    tokenHash: hashPayToken(key),
    customerRef: new Types.ObjectId(customerId),
    invoiceOnly: Boolean(invoiceId),
    items: items.map(({ id, kind, amountCents }) => ({ id, kind, amountCents })),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return { payUrl: buildCheckoutUrl(key), invoiceId: invoiceId ?? "", totalCents };
}

export async function loadScopedCheckout(key: string): Promise<{
  customerId: string;
  items: CheckoutLinkItem[];
  cart: PublicCheckoutCart & { invoiceOnly: boolean };
}> {
  const link = await CheckoutLink.findOne({ tokenHash: hashPayToken(key) }).lean();
  if (!link) throw new CheckoutError("Payment link not found", 404);
  if (link.expiresAt.getTime() <= Date.now()) {
    throw new CheckoutError("Payment link expired. Please request a new payment link.", 410);
  }
  const customerId = String(link.customerRef);
  const customer = await Customer.exists({ _id: link.customerRef, deletedAt: null, mergedIntoRef: null });
  if (!customer) throw new CheckoutError("Customer not found", 404);
  // Check the exact stored invoice documents, including ones no longer payable.
  const invoices = await Invoice.find({
    _id: { $in: link.items.filter((item) => item.kind === "invoice").map((item) => item.id) },
  }).lean();
  for (const invoice of invoices) {
    if (invoice.status === "paid" || invoice.status === "void") {
      throw new CheckoutError(`Invoice ${invoice.number} is already ${invoice.status}. No payment is due through this link.`, 409);
    }
  }
  const cart = await listPayableCart([customerId]);
  const keys = new Set(link.items.map((item) => `${item.kind}:${item.id}`));
  const items = cart.items.filter((item) => keys.has(`${item.kind}:${item.id}`));
  if (!checkoutScopeMatches(link.items, items)) {
    throw new CheckoutError(CHANGED_CHECKOUT_MESSAGE, 409);
  }
  return {
    customerId,
    items: link.items,
    cart: {
      ...cart,
      items,
      totalCents: items.reduce((sum, item) => sum + item.amountCents, 0),
      invoiceOnly: link.invoiceOnly,
    },
  };
}

export function assertScopedSelection(
  items: CheckoutLinkItem[],
  invoiceIds?: string[],
  workOrderIds?: string[],
): void {
  if (!checkoutSelectionAllowed(items, invoiceIds, workOrderIds)) {
    throw new CheckoutError("Only items included in this payment link can be paid.", 400);
  }
}

export function paymentAmountLabel(cents: number, invoiceOnly: boolean): string {
  return `${invoiceOnly ? "Invoice total" : "Latest eligible invoice total"}: $${(cents / 100).toFixed(2)}`;
}

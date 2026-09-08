import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { PaymentProviderName } from "../models/mongo/PaymentProviderAccount";
import { resolveCheckoutBuyer } from "../payments/checkoutBuyer";
import { getAdapter, resolveCheckoutProviderForInvoice } from "../payments/registry";
import { RetrievedProviderPayment } from "../payments/types";
import {
  getPaymentProviderAccountById,
  getPaymentProviderAccountsForWebhook,
  PaymentAccountWithSecrets,
} from "./paymentProvider.service";
import {
  createPendingRedemption,
  DiscountError,
  DiscountQuote,
  finalizeRedemptionsForInvoices,
  quoteDiscount,
} from "./discount.service";
import {
  dollarsToCents,
  ensureOpenInvoiceForWorkOrder,
  findInvoicesForWebhook,
  InvoiceAmountError,
  markInvoicePaid,
} from "./invoice.service";
import { buildCheckoutCompleteUrl } from "../utils/checkoutKey";
import {
  findUnbilledWorkOrdersForCustomers,
  paymentNoteForInvoiceIds,
} from "../utils/paymentLinkForCustomer";

const PAYABLE_INVOICE_STATUSES = ["open", "draft", "failed"] as const;

export type CheckoutItemKind = "invoice" | "work_order";

export type PublicCheckoutItem = {
  id: string;
  kind: CheckoutItemKind;
  number: string;
  description: string;
  amountCents: number;
  status: string;
  sourceType?: string;
};

export type PublicCheckoutCart = {
  customerLabel: string;
  items: PublicCheckoutItem[];
  totalCents: number;
};

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

function shortCustomerLabel(customer: {
  accountName?: string;
  first?: string;
  last?: string;
}): string {
  const first = (customer.first ?? "").trim();
  const last = (customer.last ?? "").trim();
  if (first && last) return `${first} ${last.charAt(0)}.`;
  if (first) return first;
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  return "Customer";
}

function invoiceDescription(invoice: {
  lineItems?: Array<{ description?: string }>;
  sourceType?: string;
}): string {
  return (
    invoice.lineItems?.[0]?.description ||
    (invoice.sourceType ?? "invoice").replace(/_/g, " ")
  );
}

export async function listPayableCart(
  customerIds: string[],
  options?: { preferredCustomerId?: string },
): Promise<PublicCheckoutCart> {
  const unique = [
    ...new Set(customerIds.filter((id) => Types.ObjectId.isValid(id))),
  ];
  if (unique.length === 0) {
    return { customerLabel: "", items: [], totalCents: 0 };
  }

  const objectIds = unique.map((id) => new Types.ObjectId(id));
  const [customers, invoices, unbilled] = await Promise.all([
    Customer.find({ _id: { $in: objectIds } })
      .select("first last accountName")
      .lean(),
    Invoice.find({
      customerRef: { $in: objectIds },
      status: { $in: PAYABLE_INVOICE_STATUSES },
    })
      .sort({ issuedAt: 1 })
      .lean(),
    findUnbilledWorkOrdersForCustomers(unique),
  ]);

  const items: PublicCheckoutItem[] = [];
  for (const invoice of invoices) {
    items.push({
      id: String(invoice._id),
      kind: "invoice",
      number: invoice.number,
      description: invoiceDescription(invoice),
      amountCents: invoice.amountCents || 0,
      status: invoice.status,
      sourceType: invoice.sourceType,
    });
  }
  for (const { wo } of unbilled) {
    const legacyId = (wo as { legacyId?: number }).legacyId;
    const number =
      (wo.number ?? "").trim() ||
      (legacyId != null ? `WO ${legacyId}` : "Work order");
    items.push({
      id: String(wo._id),
      kind: "work_order",
      number,
      description: (wo.descPerform ?? "").trim() || "Unpaid work order",
      amountCents: dollarsToCents(wo.total || 0),
      status: "unpaid",
      sourceType: "work_order",
    });
  }

  const preferredId = options?.preferredCustomerId;
  const preferred =
    (preferredId
      ? customers.find((customer) => String(customer._id) === preferredId)
      : undefined) ?? customers[0];
  const customerLabel = preferred ? shortCustomerLabel(preferred) : "";

  return {
    customerLabel,
    items,
    totalCents: items.reduce((sum, item) => sum + item.amountCents, 0),
  };
}

function uniqueObjectIds(ids: string[] | undefined): Types.ObjectId[] {
  return [
    ...new Set((ids ?? []).filter((id) => Types.ObjectId.isValid(id))),
  ].map((id) => new Types.ObjectId(id));
}

export type CheckoutQuoteItem = {
  amountCents: number;
  sourceType: string;
};

export type ResolvedCheckoutSelection = {
  unpaid: IInvoice[];
  quoteItems: CheckoutQuoteItem[];
  customerRef: string | null;
};

async function resolveCheckoutSelection(input: {
  customerIds: string[];
  invoiceIds?: string[];
  workOrderIds?: string[];
  ensureWorkOrderInvoices: boolean;
}): Promise<ResolvedCheckoutSelection> {
  const allowed = new Set(
    input.customerIds.filter((id) => Types.ObjectId.isValid(id)),
  );
  if (allowed.size === 0) {
    throw new CheckoutError("No customer account", 403);
  }

  const invoiceIds = uniqueObjectIds(input.invoiceIds);
  const workOrderIds = uniqueObjectIds(input.workOrderIds);
  if (invoiceIds.length === 0 && workOrderIds.length === 0) {
    throw new CheckoutError("Select at least one item to pay", 400);
  }

  const invoices = await Invoice.find({ _id: { $in: invoiceIds } });
  if (invoices.length !== invoiceIds.length) {
    throw new CheckoutError("One or more invoices were not found", 400);
  }
  for (const invoice of invoices) {
    if (!invoice.customerRef || !allowed.has(String(invoice.customerRef))) {
      throw new CheckoutError("Invoice does not belong to this customer", 403);
    }
    if (invoice.status === "paid" || invoice.status === "void") {
      throw new CheckoutError(
        `Invoice ${invoice.number} is ${invoice.status}`,
        400,
      );
    }
  }

  const workOrders = await WorkOrder.find({ _id: { $in: workOrderIds } });
  if (workOrders.length !== workOrderIds.length) {
    throw new CheckoutError("One or more work orders were not found", 400);
  }

  const customers = await Customer.find({
    _id: { $in: [...allowed].map((id) => new Types.ObjectId(id)) },
  })
    .select("_id legacyId")
    .lean();
  const legacyAllowed = new Set(
    customers
      .map((customer) => customer.legacyId)
      .filter((id): id is number => typeof id === "number"),
  );

  for (const wo of workOrders) {
    const byRef = wo.customerRef && allowed.has(String(wo.customerRef));
    const byLegacy = legacyAllowed.has(wo.customerId);
    if (!byRef && !byLegacy) {
      throw new CheckoutError(
        "Work order does not belong to this customer",
        403,
      );
    }
    if (wo.paid) {
      throw new CheckoutError("Work order is already paid", 400);
    }
  }

  const quoteItems: CheckoutQuoteItem[] = invoices.map((invoice) => ({
    amountCents: invoice.amountCents || 0,
    sourceType: invoice.sourceType,
  }));

  if (!input.ensureWorkOrderInvoices) {
    for (const wo of workOrders) {
      quoteItems.push({
        amountCents: dollarsToCents(wo.total || 0),
        sourceType: "work_order",
      });
    }
    const customerRefs = new Set(
      [
        ...invoices
          .map((invoice) =>
            invoice.customerRef ? String(invoice.customerRef) : "",
          )
          .filter(Boolean),
        ...workOrders
          .map((wo) => (wo.customerRef ? String(wo.customerRef) : ""))
          .filter(Boolean),
      ],
    );
    if (customerRefs.size > 1) {
      throw new CheckoutError(
        "Selected items belong to different accounts. Pay one account at a time.",
        400,
      );
    }
    return {
      unpaid: invoices.filter(
        (invoice) => invoice.status !== "paid" && invoice.status !== "void",
      ),
      quoteItems,
      customerRef: [...customerRefs][0] ?? [...allowed][0] ?? null,
    };
  }

  const ensured: IInvoice[] = [];
  for (const wo of workOrders) {
    try {
      const { invoice } = await ensureOpenInvoiceForWorkOrder(wo);
      ensured.push(invoice);
    } catch (err) {
      if (err instanceof InvoiceAmountError) {
        throw new CheckoutError(err.message, 400);
      }
      throw err;
    }
  }

  const allInvoices: IInvoice[] = [...invoices];
  const seen = new Set(allInvoices.map((invoice) => String(invoice._id)));
  for (const invoice of ensured) {
    if (seen.has(String(invoice._id))) continue;
    allInvoices.push(invoice);
    seen.add(String(invoice._id));
  }

  const unpaid = allInvoices.filter(
    (invoice) => invoice.status !== "paid" && invoice.status !== "void",
  );
  if (unpaid.length === 0) {
    throw new CheckoutError("Nothing to pay", 400);
  }

  const customerRefs = new Set(
    unpaid
      .map((invoice) =>
        invoice.customerRef ? String(invoice.customerRef) : "",
      )
      .filter(Boolean),
  );
  if (customerRefs.size > 1) {
    throw new CheckoutError(
      "Selected items belong to different accounts. Pay one account at a time.",
      400,
    );
  }

  return {
    unpaid,
    quoteItems: unpaid.map((invoice) => ({
      amountCents: invoice.amountCents || 0,
      sourceType: invoice.sourceType,
    })),
    customerRef: [...customerRefs][0] ?? null,
  };
}

function publicDiscountQuote(quote: DiscountQuote) {
  return {
    code: quote.code,
    label: quote.label,
    mode: quote.mode,
    discountCents: quote.discountCents,
    subtotalCents: quote.subtotalCents,
    eligibleCents: quote.eligibleCents,
    totalCents: quote.totalCents,
  };
}

export async function previewCheckoutDiscount(input: {
  customerIds: string[];
  invoiceIds?: string[];
  workOrderIds?: string[];
  discountCode: string;
}) {
  const selection = await resolveCheckoutSelection({
    ...input,
    ensureWorkOrderInvoices: false,
  });
  try {
    const quote = await quoteDiscount({
      code: input.discountCode,
      customerRef: selection.customerRef,
      items: selection.quoteItems,
    });
    return publicDiscountQuote(quote);
  } catch (err) {
    if (err instanceof DiscountError) {
      throw new CheckoutError(err.message, err.statusCode);
    }
    throw err;
  }
}

export type ConfirmCheckoutStatus = "paid" | "failed" | "pending";

export type PublicConfirmInvoice = {
  _id: string;
  number: string;
  description: string;
  amountCents: number;
  status: string;
  sourceType?: string;
};

function toReceiptInvoice(invoice: IInvoice): PublicConfirmInvoice {
  return {
    _id: String(invoice._id),
    number: invoice.number,
    description: invoiceDescription(invoice),
    amountCents: invoice.amountCents || 0,
    status: invoice.status,
    sourceType: invoice.sourceType,
  };
}

function invoiceMatchesPayment(
  retrieved: RetrievedProviderPayment,
  invoice: IInvoice,
): boolean {
  const id = String(invoice._id);
  if (retrieved.invoiceIds.includes(id)) return true;
  if (
    retrieved.providerOrderId &&
    invoice.providerOrderId === retrieved.providerOrderId
  ) {
    return true;
  }
  if (
    retrieved.providerPaymentId &&
    invoice.providerPaymentId === retrieved.providerPaymentId
  ) {
    return true;
  }
  return false;
}

async function accountsForConfirm(
  invoices: IInvoice[],
): Promise<PaymentAccountWithSecrets[]> {
  const seen = new Set<string>();
  const accounts: PaymentAccountWithSecrets[] = [];
  for (const invoice of invoices) {
    const ref = invoice.paymentProviderAccountRef;
    if (!ref) continue;
    const id = String(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    const account = await getPaymentProviderAccountById(id);
    if (account) accounts.push(account);
  }
  if (accounts.length > 0) return accounts;

  const provider = (invoices[0]?.paymentProvider ??
    "square") as PaymentProviderName;
  return getPaymentProviderAccountsForWebhook(provider);
}

async function retrieveProviderPayment(
  invoices: IInvoice[],
  transactionId?: string,
  orderId?: string,
): Promise<RetrievedProviderPayment | null> {
  const provider = (invoices[0]?.paymentProvider ??
    "square") as PaymentProviderName;
  const adapter = getAdapter(provider);
  if (!adapter.retrievePayment && !adapter.retrieveOrder) {
    throw new CheckoutError(
      "Payment confirmation is not available for this provider",
      400,
    );
  }

  const accounts = await accountsForConfirm(invoices);
  if (accounts.length === 0) {
    throw new CheckoutError("No payment account configured", 400);
  }

  let lastError: unknown;
  for (const account of accounts) {
    if (transactionId && adapter.retrievePayment) {
      try {
        const payment = await adapter.retrievePayment(account, transactionId);
        if (payment) return payment;
      } catch (err) {
        lastError = err;
      }
    }
    const orderCandidates = [
      orderId,
      transactionId,
      invoices[0]?.providerOrderId ?? undefined,
    ].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
    if (adapter.retrieveOrder) {
      for (const lookupOrderId of orderCandidates) {
        try {
          const order = await adapter.retrieveOrder(account, lookupOrderId);
          if (order) return order;
        } catch (err) {
          lastError = err;
        }
      }
    }
  }

  if (lastError) {
    throw new CheckoutError(
      lastError instanceof Error
        ? lastError.message
        : "Could not retrieve payment from Square",
      502,
    );
  }
  return null;
}

export async function confirmCustomerCheckout(input: {
  invoiceId?: string;
  transactionId?: string;
  orderId?: string;
}): Promise<{
  status: ConfirmCheckoutStatus;
  invoices: PublicConfirmInvoice[];
}> {
  const invoiceId = (input.invoiceId ?? "").trim() || undefined;
  const transactionId = (input.transactionId ?? "").trim() || undefined;
  const orderId = (input.orderId ?? "").trim() || undefined;

  if (!invoiceId && !transactionId && !orderId) {
    throw new CheckoutError("invoiceId, transactionId, or orderId is required", 400);
  }

  const candidates = await findInvoicesForWebhook({
    invoiceId,
    providerOrderId: orderId,
    providerPaymentId: transactionId,
  });
  if (candidates.length === 0) {
    throw new CheckoutError("Invoice not found", 404);
  }

  if (invoiceId) {
    const requested = candidates.find(
      (invoice) => String(invoice._id) === invoiceId,
    );
    if (!requested) {
      throw new CheckoutError("Invoice not found", 404);
    }
    if (requested.status === "paid") {
      return { status: "paid", invoices: [toReceiptInvoice(requested)] };
    }
  } else if (candidates.every((invoice) => invoice.status === "paid")) {
    return { status: "paid", invoices: candidates.map(toReceiptInvoice) };
  }

  if (!transactionId && !orderId && !candidates.some((invoice) => invoice.providerOrderId || invoice.providerPaymentId)) {
    throw new CheckoutError("Payment reference is required", 400);
  }

  const retrieved = await retrieveProviderPayment(
    candidates,
    transactionId,
    orderId,
  );
  if (!retrieved) {
    throw new CheckoutError("Could not retrieve payment from Square", 502);
  }

  const invoices = candidates.filter((invoice) =>
    invoiceMatchesPayment(retrieved, invoice),
  );
  if (invoices.length === 0) {
    throw new CheckoutError("Payment does not match this checkout", 403);
  }
  if (invoiceId && !invoices.some((invoice) => String(invoice._id) === invoiceId)) {
    throw new CheckoutError("Payment does not match this checkout", 403);
  }

  if (invoices.every((invoice) => invoice.status === "paid")) {
    return { status: "paid", invoices: invoices.map(toReceiptInvoice) };
  }

  if (retrieved.status === "pending") {
    return { status: "pending", invoices: invoices.map(toReceiptInvoice) };
  }

  if (retrieved.status === "paid") {
    for (const invoice of invoices) {
      await markInvoicePaid({
        invoice,
        providerPaymentId: retrieved.providerPaymentId,
        providerOrderId: retrieved.providerOrderId,
      });
    }
    await finalizeRedemptionsForInvoices(
      invoices.map((invoice) => String(invoice._id)),
    );
    return { status: "paid", invoices: invoices.map(toReceiptInvoice) };
  }

  for (const invoice of invoices) {
    if (invoice.status !== "paid") {
      invoice.status = "failed";
      await invoice.save();
    }
  }
  return { status: "failed", invoices: invoices.map(toReceiptInvoice) };
}

export async function startCustomerCheckout(input: {
  customerIds: string[];
  invoiceIds?: string[];
  workOrderIds?: string[];
  discountCode?: string;
  checkoutKey?: string;
  returnFrom?: "dashboard";
}): Promise<{ url: string }> {
  const selection = await resolveCheckoutSelection({
    ...input,
    ensureWorkOrderInvoices: true,
  });
  const unpaid = selection.unpaid;
  const primary = unpaid[0];

  let amountCents = unpaid.reduce(
    (sum, invoice) => sum + (invoice.amountCents || 0),
    0,
  );
  if (amountCents <= 0) {
    throw new CheckoutError("Amount must be greater than zero", 400);
  }

  const code = (input.discountCode ?? "").trim();
  if (code) {
    try {
      const quote = await quoteDiscount({
        code,
        customerRef: selection.customerRef,
        items: selection.quoteItems,
      });
      if (!selection.customerRef) {
        throw new CheckoutError("No customer account", 403);
      }
      await createPendingRedemption({
        quote,
        customerRef: selection.customerRef,
        invoices: unpaid,
      });
      amountCents = quote.totalCents;
    } catch (err) {
      if (err instanceof DiscountError) {
        throw new CheckoutError(err.message, err.statusCode);
      }
      throw err;
    }
  }

  const redirectUrl = buildCheckoutCompleteUrl(String(primary._id), {
    checkoutKey: input.checkoutKey,
    from: input.returnFrom,
  });
  const paidInvoiceIds = unpaid.map((invoice) => String(invoice._id));

  if (amountCents === 0) {
    for (const invoice of unpaid) {
      if (invoice.status === "draft" || invoice.status === "failed") {
        invoice.status = "open";
        await invoice.save();
      }
      await markInvoicePaid({ invoice });
    }
    await finalizeRedemptionsForInvoices(paidInvoiceIds);
    return { url: redirectUrl };
  }

  const { adapter, account } = await resolveCheckoutProviderForInvoice(
    primary.customerRef,
  );
  const buyer = await resolveCheckoutBuyer(primary.customerRef);

  const result = await adapter.createCheckout({
    invoice: primary,
    account,
    redirectUrl,
    buyer,
    amountCents,
    paymentNote: paymentNoteForInvoiceIds(paidInvoiceIds),
    checkoutName:
      unpaid.length > 1
        ? `Outstanding balance (${unpaid.length} items)`
        : undefined,
    checkoutDescription:
      unpaid.length > 1
        ? unpaid.map((invoice) => invoice.number).join(", ")
        : undefined,
  });

  for (const invoice of unpaid) {
    invoice.paymentProvider = adapter.name;
    invoice.paymentProviderAccountRef = account.account._id as Types.ObjectId;
    invoice.providerCheckoutId = result.checkoutId;
    invoice.providerOrderId = result.orderId ?? invoice.providerOrderId;
    if (invoice.status === "draft" || invoice.status === "failed") {
      invoice.status = "open";
    }
    await invoice.save();
  }

  return { url: result.url };
}

import { randomInt } from "crypto";
import { PipelineStage, Types } from "mongoose";
import { Contract, IContract } from "../models/mongo/Contract";
import { Customer } from "../models/mongo/Customer";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { WorkOrder, IWorkOrder } from "../models/mongo/WorkOrder";
import {
  computeRenewalDueDateAfterRenewal,
  parseDateOnly,
  startOfDay,
} from "../utils/contractDates";
import { promoteTemporaryContract } from "../utils/temporaryContractOffer";
import { SCHEDULE_TIMEZONE } from "../utils/scheduleTime";
import { logNotificationAsync } from "./notification.service";
import { recordCustomerActivityAsync } from "./customerActivity.service";
import {
  inferPaymentMethod,
  paymentSourceEventId,
  recordInvoiceEventAsync,
} from "./invoiceEvent.service";
import type { InvoicePaymentMethod } from "../models/mongo/InvoiceEvent";
import { PaymentProviderName } from "../models/mongo/PaymentProviderAccount";
import {
  companyTaxForUnpaidWorkOrder,
  computeTaxAmount,
  getTaxRatePercent,
  snapshotDocumentTax,
  taxCentsFromDollars,
} from "./taxSettings";

export type ApplyRenewalInput = {
  contract: IContract;
  renewedAt: Date;
  durationMonths: number;
  notes?: string;
  invoiceRef?: Types.ObjectId;
  amountCents?: number;
  paymentProvider?: PaymentProviderName | null;
  providerPaymentId?: string | null;
  userId?: number;
  actorUserId?: string;
  actorName?: string;
};

export class DeletedCustomerRenewalError extends Error {
  constructor() {
    super("Cannot renew a contract for a deleted customer");
    this.name = "DeletedCustomerRenewalError";
  }
}

export async function applyContractRenewal(
  input: ApplyRenewalInput,
): Promise<IContract> {
  const {
    contract,
    renewedAt,
    durationMonths,
    notes,
    invoiceRef,
    amountCents,
    paymentProvider,
    providerPaymentId,
    userId,
    actorUserId,
  } = input;

  if (contract.customerRef) {
    const active = await Customer.exists({
      _id: contract.customerRef,
      deletedAt: null,
    });
    if (!active) throw new DeletedCustomerRenewalError();
  }

  if (!contract.renewalDueDate) {
    throw new Error(
      "Contract must have a renewal due date before recording a renewal",
    );
  }

  const previousDueDate = parseDateOnly(contract.renewalDueDate);
  if (!previousDueDate) {
    throw new Error("Invalid renewal due date on contract");
  }

  const renewedAtDate = parseDateOnly(renewedAt) ?? startOfDay(renewedAt);
  const { newDueDate, wasLate } = computeRenewalDueDateAfterRenewal(
    renewedAtDate,
    previousDueDate,
    durationMonths,
  );

  const renewalEvent = {
    renewedAt: renewedAtDate,
    durationMonths,
    previousDueDate,
    newDueDate,
    wasLate,
    notes: notes ?? "",
    userId,
    invoiceRef,
    amountCents,
    paymentProvider: paymentProvider ?? undefined,
    providerPaymentId: providerPaymentId ?? undefined,
    createdAt: new Date(),
  };

  contract.lastRenewalDate = renewedAtDate;
  contract.durationMonths = durationMonths;
  contract.renewalDueDate = newDueDate;
  if (wasLate) {
    contract.contractDate = renewedAtDate;
  }
  contract.renewals.push(renewalEvent);
  await contract.save();

  logNotificationAsync({
    entityType: "contract",
    action: "renewed",
    entityId: String(contract._id),
    customerRef: contract.customerRef ?? null,
    summary: "Contract renewed",
    actorType: actorUserId ? "user" : "system",
    actorUserId: actorUserId ?? null,
    actorName: input.actorName,
  });

  return contract;
}

type InvoiceActor = {
  actorType?: "user" | "system";
  actorUserId?: string | null;
  actorName?: string | null;
};

export async function markInvoicePaid(params: {
  invoice: IInvoice;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  actor?: InvoiceActor;
  /** Set when the payer is the customer and no staff user is on the request. */
  paidByCustomer?: boolean;
  method?: InvoicePaymentMethod;
}): Promise<IInvoice> {
  const { invoice, providerPaymentId, providerOrderId, actor, paidByCustomer } =
    params;

  if (invoice.status === "paid") {
    return invoice;
  }

  invoice.status = "paid";
  invoice.paidAt = new Date();
  if (providerPaymentId) invoice.providerPaymentId = providerPaymentId;
  if (providerOrderId) invoice.providerOrderId = providerOrderId;
  await invoice.save();

  const method =
    params.method ??
    inferPaymentMethod(invoice, { providerPaymentId, providerOrderId, paidByCustomer });
  const offline = method === "check" || method === "cash";
  recordInvoiceEventAsync({
    invoiceRef: invoice._id as Types.ObjectId,
    customerRef: invoice.customerRef ?? null,
    kind: "payment_succeeded",
    method,
    provider: offline || method === "manual" ? null : invoice.paymentProvider ?? null,
    amountCents: invoice.amountCents,
    reason:
      method === "check" && invoice.offlinePayment?.checkNumber
        ? `Check #${invoice.offlinePayment.checkNumber}`
        : null,
    providerPaymentId: providerPaymentId ?? null,
    providerOrderId: providerOrderId ?? null,
    actorKind: paidByCustomer ? "customer" : actor?.actorUserId ? "staff" : "system",
    actorUserId: paidByCustomer ? null : actor?.actorUserId ?? null,
    actorName: paidByCustomer ? null : actor?.actorName ?? null,
    source: paidByCustomer ? "webhook" : actor?.actorUserId ? "crm" : "job",
    sourceEventId: paymentSourceEventId(
      invoice._id as Types.ObjectId,
      invoice.paymentProvider,
      providerPaymentId ?? providerOrderId,
      "paid",
    ),
  });

  logNotificationAsync({
    entityType: "invoice",
    action: "updated",
    entityId: String(invoice._id),
    customerRef: invoice.customerRef ?? null,
    summary: `Invoice ${invoice.number} paid`,
    actorType: actor?.actorType ?? "system",
    actorUserId: actor?.actorUserId ?? null,
    actorName: actor?.actorName ?? (actor?.actorUserId ? undefined : "System"),
    metadata: {
      sourceType: invoice.sourceType,
      amountCents: invoice.amountCents,
    },
  });

  if (invoice.customerRef) {
    const amount = (invoice.amountCents / 100).toFixed(2);
    recordCustomerActivityAsync({
      customerRef: invoice.customerRef,
      category: "payment",
      action: "paid",
      summary: paidByCustomer
        ? `Paid invoice ${invoice.number} ($${amount})`
        : `Invoice ${invoice.number} marked paid ($${amount})`,
      actorKind: paidByCustomer
        ? "customer"
        : actor?.actorUserId
          ? undefined
          : "system",
      actorUserId: paidByCustomer ? null : actor?.actorUserId ?? null,
      actorName: paidByCustomer ? "Customer" : actor?.actorName ?? null,
      entityType: "invoice",
      entityId: String(invoice._id),
      source: paidByCustomer ? "webhook" : actor?.actorUserId ? "crm" : "job",
      metadata: {
        amountCents: invoice.amountCents,
        number: invoice.number,
        provider: invoice.paymentProvider,
      },
    });
  }

  if (
    (invoice.sourceType === "contract_renewal" ||
      invoice.sourceType === "contract_initial") &&
    invoice.contractRef
  ) {
    const contract = await Contract.findById(invoice.contractRef);
    if (contract && invoice.sourceType === "contract_initial" && contract.temporary) {
      promoteTemporaryContract(contract, invoice.paidAt ?? new Date());
      await contract.save();
    } else if (contract && invoice.sourceType === "contract_renewal") {
      const durationMonths =
        typeof invoice.metadata?.durationMonths === "number"
          ? invoice.metadata.durationMonths
          : contract.durationMonths || 12;

      // Avoid double-renewing if already linked to this invoice
      const already = contract.renewals.some(
        (r) => r.invoiceRef && String(r.invoiceRef) === String(invoice._id),
      );
      if (!already) {
        try {
          await applyContractRenewal({
            contract,
            renewedAt: new Date(),
            durationMonths,
            notes: `Paid via invoice ${invoice.number}`,
            invoiceRef: invoice._id as Types.ObjectId,
            amountCents: invoice.amountCents,
            paymentProvider: invoice.paymentProvider,
            providerPaymentId: invoice.providerPaymentId,
          });
        } catch (err) {
          if (!(err instanceof DeletedCustomerRenewalError)) throw err;
        }
      }
    }
  }

  if (invoice.sourceType === "work_order" && invoice.workOrderRef) {
    await WorkOrder.findByIdAndUpdate(invoice.workOrderRef, {
      $set: { paid: true },
    });
  }

  return invoice;
}

export async function reopenInvoice(params: {
  invoice: IInvoice;
  actor?: InvoiceActor;
}): Promise<IInvoice> {
  const { invoice, actor } = params;

  if (invoice.status !== "paid") {
    return invoice;
  }

  invoice.status = "open";
  invoice.paidAt = null;
  await invoice.save();

  logNotificationAsync({
    entityType: "invoice",
    action: "updated",
    entityId: String(invoice._id),
    customerRef: invoice.customerRef ?? null,
    summary: `Invoice ${invoice.number} reopened`,
    actorType: actor?.actorType ?? "system",
    actorUserId: actor?.actorUserId ?? null,
    actorName: actor?.actorName ?? (actor?.actorUserId ? undefined : "System"),
    metadata: {
      sourceType: invoice.sourceType,
      amountCents: invoice.amountCents,
    },
  });

  if (invoice.sourceType === "work_order" && invoice.workOrderRef) {
    await WorkOrder.findByIdAndUpdate(invoice.workOrderRef, {
      $set: { paid: false },
    });
  }

  return invoice;
}

export async function findInvoiceForWebhook(params: {
  invoiceId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
}): Promise<IInvoice | null> {
  const invoices = await findInvoicesForWebhook(params);
  return invoices[0] ?? null;
}

export async function findInvoicesForWebhook(params: {
  invoiceId?: string;
  invoiceIds?: string[];
  providerOrderId?: string;
  providerPaymentId?: string;
}): Promise<IInvoice[]> {
  const found = new Map<string, IInvoice>();

  const ids = [
    ...new Set(
      [...(params.invoiceIds ?? []), params.invoiceId].filter(
        (id): id is string =>
          typeof id === "string" && Types.ObjectId.isValid(id),
      ),
    ),
  ];
  if (ids.length > 0) {
    const byIds = await Invoice.find({ _id: { $in: ids } });
    for (const invoice of byIds) found.set(String(invoice._id), invoice);
  }
  if (params.providerPaymentId) {
    const byPayment = await Invoice.find({
      providerPaymentId: params.providerPaymentId,
    });
    for (const invoice of byPayment) found.set(String(invoice._id), invoice);
  }
  if (params.providerOrderId) {
    const byOrder = await Invoice.find({
      providerOrderId: params.providerOrderId,
    });
    for (const invoice of byOrder) found.set(String(invoice._id), invoice);
  }
  // Square Point of Sale returns the order ID as the transaction ID.
  const posIds = [params.providerOrderId, params.providerPaymentId].filter(
    (id): id is string => Boolean(id),
  );
  if (found.size === 0 && posIds.length > 0) {
    const byPosCharge = await Invoice.find({
      "posCharge.transactionId": { $in: posIds },
    });
    for (const invoice of byPosCharge) found.set(String(invoice._id), invoice);
  }

  if (found.size === 0 && ids.length === 1) {
    const one = await Invoice.findById(ids[0]);
    if (one) found.set(String(one._id), one);
  }

  if (found.size === 1) {
    const only = [...found.values()][0];
    if (only.payTokenHash) {
      const siblings = await Invoice.find({
        payTokenHash: only.payTokenHash,
        status: { $in: ["open", "draft", "failed"] },
      });
      for (const invoice of siblings) found.set(String(invoice._id), invoice);
    }
  }

  return [...found.values()];
}

export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

export class InvoiceAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceAmountError";
  }
}

export type WorkOrderInvoiceSource = {
  _id: Types.ObjectId;
  customerId: number;
  customerRef?: Types.ObjectId | null;
  parts?: IWorkOrder["parts"];
  totalLabor?: number;
  miscExp?: number;
  shipping?: number;
  subtotal?: number;
  taxRate?: number;
  tax?: number;
  taxOverridden?: boolean;
  total?: number;
  descPerform?: string;
  number?: string;
  paid?: boolean;
  completed?: boolean;
  date?: Date | null;
  updatedAt?: Date;
};

function invoiceTaxFromWorkOrder(wo: WorkOrderInvoiceSource) {
  return snapshotDocumentTax({
    taxRatePercent: wo.taxRate,
    taxDollars: wo.tax,
    taxOverridden: wo.taxOverridden,
  });
}

/** Persist the company rate onto an unpaid work order that is not tax-overridden. */
async function alignUnpaidWorkOrderToCompanyTax(
  wo: WorkOrderInvoiceSource,
): Promise<void> {
  if (wo.paid || wo.taxOverridden) return;
  const rate = await getTaxRatePercent();
  const next = companyTaxForUnpaidWorkOrder(
    {
      paid: wo.paid,
      taxOverridden: wo.taxOverridden,
      subtotal: wo.subtotal,
      shipping: wo.shipping,
      taxRate: wo.taxRate,
      tax: wo.tax,
      total: wo.total,
    },
    rate,
  );
  if (!next) return;
  wo.taxRate = next.taxRate;
  wo.tax = next.tax;
  wo.total = next.total;
  wo.taxOverridden = false;
  await WorkOrder.updateOne(
    { _id: wo._id },
    {
      $set: {
        taxRate: next.taxRate,
        tax: next.tax,
        total: next.total,
        taxOverridden: false,
      },
    },
  );
}

export async function invoiceTaxFromCurrentRate(
  preTaxCents: number,
): Promise<{
  taxRatePercent: number;
  taxCents: number;
  taxOverridden: boolean;
}> {
  const taxRatePercent = await getTaxRatePercent();
  const taxCents = taxCentsFromDollars(
    computeTaxAmount(preTaxCents / 100, taxRatePercent),
  );
  return { taxRatePercent, taxCents, taxOverridden: false };
}

export async function resolveCustomerRefForWorkOrder(
  wo: WorkOrderInvoiceSource,
): Promise<Types.ObjectId | undefined> {
  if (wo.customerRef) return wo.customerRef;
  if (typeof wo.customerId !== "number") return undefined;
  const customer = await Customer.findOne({ legacyId: wo.customerId })
    .select("_id")
    .lean();
  return customer?._id as Types.ObjectId | undefined;
}

async function persistResolvedCustomerRef(
  wo: WorkOrderInvoiceSource,
  customerRef: Types.ObjectId,
): Promise<void> {
  wo.customerRef = customerRef;
  await WorkOrder.updateOne({ _id: wo._id }, { $set: { customerRef } });
}

function invoiceLineItemsForWorkOrder(
  wo: WorkOrderInvoiceSource,
  amountCents: number,
  description?: string,
): { description: string; amountCents: number }[] {
  const builtItems = workOrderInvoiceLineItems(wo);
  const lineItems =
    builtItems.length > 0
      ? builtItems
      : [
          {
            description:
              description ||
              `Work order${wo.descPerform ? `: ${wo.descPerform}` : ""}`,
            amountCents,
          },
        ];
  if (description && lineItems.length === 1) {
    lineItems[0].description = description;
  }
  return lineItems;
}

function lineItemsChanged(
  current: Array<{ description?: string; amountCents?: number }>,
  next: Array<{ description: string; amountCents: number }>,
): boolean {
  if (current.length !== next.length) return true;
  return current.some(
    (item, i) =>
      (item.description ?? "") !== next[i].description ||
      (item.amountCents ?? 0) !== next[i].amountCents,
  );
}

export function workOrderInvoiceLineItems(wo: {
  parts?: Array<{
    partNumber?: string;
    description?: string;
    quantity?: number;
    amount?: number;
    lineType?: string;
    kind?: string;
  }>;
  totalLabor?: number;
  miscExp?: number;
  shipping?: number;
  total?: number;
  descPerform?: string;
  number?: string;
}): { description: string; amountCents: number }[] {
  const items: { description: string; amountCents: number }[] = [];
  const parts = wo.parts ?? [];
  let hasLaborProductLines = false;
  for (const part of parts) {
    if (part.lineType === "note") continue;
    if (part.lineType !== "agreement" && part.kind === "labor") {
      hasLaborProductLines = true;
    }
    const cents = dollarsToCents(part.amount || 0);
    if (cents <= 0) continue;
    const qty = part.quantity && part.quantity !== 1 ? `${part.quantity} × ` : "";
    const label =
      part.description?.trim() ||
      part.partNumber?.trim() ||
      (part.lineType === "agreement"
        ? "Agreement"
        : part.kind === "labor"
          ? "Labor"
          : part.kind === "equipment"
            ? "Equipment"
            : "Part");
    const kindPrefix =
      part.lineType !== "agreement" && part.kind === "equipment" && part.description?.trim()
        ? "Equipment · "
        : "";
    items.push({
      description: `${qty}${kindPrefix}${label}${part.partNumber && part.description ? ` (${part.partNumber})` : ""}`,
      amountCents: cents,
    });
  }
  const laborCents = dollarsToCents(wo.totalLabor || 0);
  if (!hasLaborProductLines && laborCents > 0) {
    items.push({ description: "Labor", amountCents: laborCents });
  }
  const miscCents = dollarsToCents(wo.miscExp || 0);
  if (miscCents > 0) {
    items.push({ description: "Miscellaneous", amountCents: miscCents });
  }
  const shippingCents = dollarsToCents(wo.shipping || 0);
  if (shippingCents > 0) {
    items.push({ description: "Shipping", amountCents: shippingCents });
  }
  if (items.length > 0) return items;
  const lump = dollarsToCents(wo.total || 0);
  if (lump > 0) {
    return [
      {
        description:
          `Work order${wo.number ? ` ${wo.number}` : ""}${wo.descPerform ? `: ${wo.descPerform}` : ""}`.trim(),
        amountCents: lump,
      },
    ];
  }
  return [];
}

const OPEN_INVOICE_STATUSES = ["open", "draft", "failed"] as const;
const VOIDABLE_INVOICE_STATUSES = ["open", "draft"] as const;

export class WorkOrderNotReadyError extends Error {
  constructor(
    message = "Work order must be completed before it can be invoiced",
  ) {
    super(message);
    this.name = "WorkOrderNotReadyError";
  }
}

export const WORK_ORDER_REOPENED_REASON = "work_order_reopened";

function invoiceMetadata(invoice: IInvoice): Record<string, unknown> {
  return invoice.metadata && typeof invoice.metadata === "object"
    ? { ...invoice.metadata }
    : {};
}

async function voidOpenDraftWorkOrderInvoices(
  workOrderId: Types.ObjectId | string,
  reason?: string,
): Promise<IInvoice | undefined> {
  const open = await Invoice.find({
    workOrderRef: workOrderId,
    status: { $in: VOIDABLE_INVOICE_STATUSES },
  });
  let last: IInvoice | undefined;
  for (const invoice of open) {
    invoice.status = "void";
    if (reason) {
      invoice.metadata = { ...invoiceMetadata(invoice), voidReason: reason };
      invoice.markModified("metadata");
    }
    await invoice.save();
    last = invoice;
  }
  return last;
}

async function findReopenedWorkOrderInvoice(
  workOrderId: Types.ObjectId | string,
): Promise<IInvoice | null> {
  return Invoice.findOne({
    workOrderRef: workOrderId,
    status: "void",
    "metadata.voidReason": WORK_ORDER_REOPENED_REASON,
  }).sort({ updatedAt: -1, createdAt: -1 });
}

export async function findOpenInvoiceForWorkOrder(
  workOrderId: Types.ObjectId | string,
): Promise<IInvoice | null> {
  return Invoice.findOne({
    workOrderRef: workOrderId,
    status: { $in: OPEN_INVOICE_STATUSES },
  });
}

export async function ensureOpenInvoiceForWorkOrder(
  wo: WorkOrderInvoiceSource,
  options?: {
    amountCents?: number;
    description?: string;
    actor?: {
      actorType?: "user" | "system";
      actorUserId?: string | null;
      actorName?: string | null;
    };
  },
): Promise<{ invoice: IInvoice; created: boolean }> {
  if (!wo.completed) {
    throw new WorkOrderNotReadyError();
  }
  const customerRef = await resolveCustomerRefForWorkOrder(wo);
  if (customerRef) await persistResolvedCustomerRef(wo, customerRef);

  await alignUnpaidWorkOrderToCompanyTax(wo);

  const existing = await findOpenInvoiceForWorkOrder(wo._id);
  if (existing) {
    if (customerRef && !existing.customerRef) {
      existing.customerRef = customerRef;
    }
    if (!existing.taxOverridden && !wo.paid && !wo.taxOverridden) {
      const tax = invoiceTaxFromWorkOrder(wo);
      const nextAmount = dollarsToCents(wo.total || 0);
      const currentTotal =
        typeof existing.originalAmountCents === "number"
          ? existing.originalAmountCents
          : existing.amountCents;
      if (
        (existing.taxRatePercent ?? 0) !== tax.taxRatePercent ||
        (existing.taxCents ?? 0) !== tax.taxCents ||
        currentTotal !== nextAmount
      ) {
        if (typeof existing.originalAmountCents === "number") {
          existing.originalAmountCents = nextAmount;
          existing.amountCents = Math.max(
            nextAmount - (Number(existing.discountCents) || 0),
            0,
          );
        } else {
          existing.amountCents = nextAmount;
        }
        existing.taxRatePercent = tax.taxRatePercent;
        existing.taxCents = tax.taxCents;
        existing.taxOverridden = tax.taxOverridden;
      }
    }
    if (existing.isModified()) await existing.save();
    return { invoice: existing, created: false };
  }

  const reopened = await findReopenedWorkOrderInvoice(wo._id);
  if (reopened) {
    const nextAmount =
      options?.amountCents != null
        ? options.amountCents
        : dollarsToCents(wo.total || 0);
    if (nextAmount <= 0) {
      throw new InvoiceAmountError(
        "Work order total must be greater than zero to invoice",
      );
    }
    if (customerRef) reopened.customerRef = customerRef;
    reopened.status = "open";
    reopened.lineItems = invoiceLineItemsForWorkOrder(
      wo,
      nextAmount,
      options?.description,
    );
    if (typeof reopened.originalAmountCents === "number") {
      reopened.originalAmountCents = nextAmount;
      reopened.amountCents = Math.max(
        nextAmount - (Number(reopened.discountCents) || 0),
        0,
      );
    } else {
      reopened.amountCents = nextAmount;
    }
    if (!reopened.taxOverridden) {
      const tax = invoiceTaxFromWorkOrder(wo);
      reopened.taxRatePercent = tax.taxRatePercent;
      reopened.taxCents = tax.taxCents;
      reopened.taxOverridden = tax.taxOverridden;
    }
    const metadata = invoiceMetadata(reopened);
    delete metadata.voidReason;
    reopened.metadata = metadata;
    reopened.markModified("metadata");
    await reopened.save();
    return { invoice: reopened, created: false };
  }

  const amountCents =
    options?.amountCents != null
      ? options.amountCents
      : dollarsToCents(wo.total || 0);
  if (amountCents <= 0) {
    throw new InvoiceAmountError(
      "Work order total must be greater than zero to invoice",
    );
  }
  if (!customerRef) {
    throw new Error("Work order has no resolvable customer for invoicing");
  }

  const lineItems = invoiceLineItemsForWorkOrder(
    wo,
    amountCents,
    options?.description,
  );
  const tax = invoiceTaxFromWorkOrder(wo);

  const issuedAt = new Date();
  const invoice = await Invoice.create({
    number: await nextInvoiceNumber(issuedAt),
    customerId: wo.customerId,
    customerRef,
    sourceType: "work_order",
    workOrderRef: wo._id,
    lineItems,
    amountCents,
    currency: "USD",
    status: "open",
    dueDate: null,
    issuedAt,
    metadata: {},
    taxRatePercent: tax.taxRatePercent,
    taxCents: tax.taxCents,
    taxOverridden: tax.taxOverridden,
  });

  logNotificationAsync({
    entityType: "invoice",
    action: "created",
    entityId: String(invoice._id),
    customerRef,
    summary: `Invoice ${invoice.number} created`,
    actorType: options?.actor?.actorType ?? "system",
    actorUserId: options?.actor?.actorUserId ?? null,
    actorName: options?.actor?.actorName,
  });

  return { invoice, created: true };
}

export async function createPaidInvoiceForWorkOrder(
  wo: WorkOrderInvoiceSource,
  options?: { backfilled?: boolean },
): Promise<IInvoice> {
  if (!wo.completed) {
    throw new WorkOrderNotReadyError();
  }
  const customerRef = await resolveCustomerRefForWorkOrder(wo);
  if (customerRef) await persistResolvedCustomerRef(wo, customerRef);
  if (!customerRef) {
    throw new Error("Work order has no resolvable customer for invoicing");
  }

  const amountCents = dollarsToCents(wo.total || 0);
  if (amountCents <= 0) {
    throw new InvoiceAmountError(
      "Work order total must be greater than zero to invoice",
    );
  }

  const lineItems = invoiceLineItemsForWorkOrder(wo, amountCents);
  const tax = invoiceTaxFromWorkOrder(wo);
  const issuedAt =
    wo.date instanceof Date
      ? wo.date
      : wo.updatedAt instanceof Date
        ? wo.updatedAt
        : new Date();
  const invoice = await Invoice.create({
    number: await nextInvoiceNumber(issuedAt),
    customerId: wo.customerId,
    customerRef,
    sourceType: "work_order",
    workOrderRef: wo._id,
    lineItems,
    amountCents,
    currency: "USD",
    status: "paid",
    dueDate: null,
    issuedAt,
    paidAt: issuedAt,
    metadata: options?.backfilled ? { backfilled: true } : {},
    taxRatePercent: tax.taxRatePercent,
    taxCents: tax.taxCents,
    taxOverridden: tax.taxOverridden,
  });

  logNotificationAsync({
    entityType: "invoice",
    action: "created",
    entityId: String(invoice._id),
    customerRef,
    summary: `Invoice ${invoice.number} created`,
    actorType: "system",
    actorName: options?.backfilled ? "Backfill" : "System",
    metadata: {
      sourceType: "work_order",
      amountCents,
      backfilled: Boolean(options?.backfilled),
    },
  });

  return invoice;
}

export type SyncWorkOrderInvoiceResult = {
  action: "created" | "updated" | "paid" | "voided" | "skipped";
  invoice?: IInvoice;
};

export async function syncWorkOrderInvoice(
  wo: WorkOrderInvoiceSource,
  options?: { backfilled?: boolean },
): Promise<SyncWorkOrderInvoiceResult> {
  await alignUnpaidWorkOrderToCompanyTax(wo);
  const amountCents = dollarsToCents(wo.total || 0);

  if (wo.paid) {
    const unpaid = await Invoice.find({
      workOrderRef: wo._id,
      status: { $in: ["open", "draft", "failed"] },
    });
    if (unpaid.length > 0) {
      let last: IInvoice | undefined;
      for (const invoice of unpaid) {
        last = await markInvoicePaid({ invoice });
      }
      return { action: "paid", invoice: last };
    }
    if (!wo.completed || amountCents <= 0) return { action: "skipped" };
    const existing = await Invoice.findOne({
      workOrderRef: wo._id,
      status: { $ne: "void" },
    });
    if (existing) return { action: "skipped", invoice: existing };
    const reopened = await findReopenedWorkOrderInvoice(wo._id);
    if (reopened) {
      const metadata = invoiceMetadata(reopened);
      delete metadata.voidReason;
      reopened.metadata = metadata;
      reopened.markModified("metadata");
      return {
        action: "paid",
        invoice: await markInvoicePaid({ invoice: reopened }),
      };
    }
    try {
      const invoice = await createPaidInvoiceForWorkOrder(wo, {
        backfilled: options?.backfilled,
      });
      return { action: "created", invoice };
    } catch (err) {
      if (err instanceof InvoiceAmountError) return { action: "skipped" };
      throw err;
    }
  }

  if (!wo.completed || amountCents <= 0) {
    const voided = await voidOpenDraftWorkOrderInvoices(
      wo._id,
      wo.completed ? undefined : WORK_ORDER_REOPENED_REASON,
    );
    return voided
      ? { action: "voided", invoice: voided }
      : { action: "skipped" };
  }

  try {
    const { invoice, created } = await ensureOpenInvoiceForWorkOrder(wo);
    if (created) return { action: "created", invoice };

    const lineItems = invoiceLineItemsForWorkOrder(wo, amountCents);
    const tax = invoiceTaxFromWorkOrder(wo);
    const customerRef = await resolveCustomerRefForWorkOrder(wo);
    const keepInvoiceTax = Boolean(invoice.taxOverridden);
    const nextTax = keepInvoiceTax
      ? {
          taxRatePercent: Number(invoice.taxRatePercent) || 0,
          taxCents: Number(invoice.taxCents) || 0,
          taxOverridden: true,
        }
      : tax;
    const nextAmountCents = keepInvoiceTax
      ? Math.max(
          dollarsToCents(wo.total || 0) - dollarsToCents(wo.tax || 0),
          0,
        ) + nextTax.taxCents
      : amountCents;
    const needsCustomer = Boolean(customerRef && !invoice.customerRef);
    const needsAmount = invoice.amountCents !== nextAmountCents;
    const needsLines = lineItemsChanged(invoice.lineItems ?? [], lineItems);
    const needsTax =
      !keepInvoiceTax &&
      ((invoice.taxRatePercent ?? 0) !== tax.taxRatePercent ||
        (invoice.taxCents ?? 0) !== tax.taxCents ||
        Boolean(invoice.taxOverridden) !== tax.taxOverridden);
    if (needsCustomer || needsAmount || needsLines || needsTax) {
      if (customerRef) invoice.customerRef = customerRef;
      if (typeof invoice.originalAmountCents === "number") {
        invoice.originalAmountCents = nextAmountCents;
        invoice.amountCents = Math.max(
          nextAmountCents - (Number(invoice.discountCents) || 0),
          0,
        );
      } else {
        invoice.amountCents = nextAmountCents;
      }
      invoice.lineItems = lineItems;
      invoice.taxRatePercent = nextTax.taxRatePercent;
      invoice.taxCents = nextTax.taxCents;
      invoice.taxOverridden = nextTax.taxOverridden;
      await invoice.save();
      return { action: "updated", invoice };
    }
    return { action: "skipped", invoice };
  } catch (err) {
    if (err instanceof InvoiceAmountError) return { action: "skipped" };
    throw err;
  }
}

export async function findPendingCompletedWorkOrderInvoices(input?: {
  number?: RegExp;
  customerRefs?: Types.ObjectId[];
  skip?: number;
  limit?: number;
}): Promise<{ invoices: Array<Record<string, unknown>>; total: number }> {
  const match: Record<string, unknown> = {
    sourceType: "work_order",
    status: { $in: ["open", "draft", "failed"] },
    workOrderRef: { $ne: null },
    amountCents: { $gt: 0 },
  };
  if (input?.number || (input?.customerRefs && input.customerRefs.length > 0)) {
    const or: Record<string, unknown>[] = [];
    if (input.number) or.push({ number: input.number });
    if (input.customerRefs && input.customerRefs.length > 0) {
      or.push({ customerRef: { $in: input.customerRefs } });
    }
    match.$or = or;
  }

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: WorkOrder.collection.name,
        localField: "workOrderRef",
        foreignField: "_id",
        as: "workOrder",
      },
    },
    { $unwind: "$workOrder" },
    {
      $match: {
        "workOrder.completed": true,
        "workOrder.deletedAt": null,
      },
    },
    { $sort: { dueDate: -1, issuedAt: -1, createdAt: -1 } },
    { $project: { workOrder: 0 } },
  ] as PipelineStage[];

  if (input?.limit == null) {
    const invoices = await Invoice.aggregate(pipeline);
    return { invoices, total: invoices.length };
  }

  const [result] = await Invoice.aggregate([
    ...pipeline,
    {
      $facet: {
        invoices: [{ $skip: input.skip ?? 0 }, { $limit: input.limit }],
        total: [{ $count: "count" }],
      },
    },
  ]);
  return {
    invoices: result?.invoices ?? [],
    total: result?.total?.[0]?.count ?? 0,
  };
}

/** GMOF + MMDDYY + 5-digit suffix, e.g. GMOF08282684721 */
export const INVOICE_NUMBER_PATTERN = /^GMOF\d{11}$/;

const MAX_INVOICE_NUMBER_ATTEMPTS = 20;

export function invoiceNumberPrefixFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  }).formatToParts(date);
  const mm = parts.find((p) => p.type === "month")?.value ?? "00";
  const dd = parts.find((p) => p.type === "day")?.value ?? "00";
  const yy = parts.find((p) => p.type === "year")?.value ?? "00";
  return `GMOF${mm}${dd}${yy}`;
}

export async function nextInvoiceNumber(
  issuedAt: Date = new Date(),
  reserved?: Set<string>,
): Promise<string> {
  const prefix = invoiceNumberPrefixFromDate(issuedAt);
  for (let i = 0; i < MAX_INVOICE_NUMBER_ATTEMPTS; i++) {
    const suffix = String(randomInt(0, 100_000)).padStart(5, "0");
    const number = `${prefix}${suffix}`;
    if (reserved?.has(number)) continue;
    const exists = await Invoice.exists({ number });
    if (!exists) return number;
  }
  throw new Error("Unable to allocate a unique invoice number");
}

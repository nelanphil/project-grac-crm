import { randomInt } from "crypto";
import { Types } from "mongoose";
import { Contract, IContract } from "../models/mongo/Contract";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  computeRenewalDueDateAfterRenewal,
  parseDateOnly,
  startOfDay,
} from "../utils/contractDates";
import { SCHEDULE_TIMEZONE } from "../utils/scheduleTime";
import { logNotificationAsync } from "./notification.service";
import { PaymentProviderName } from "../models/mongo/PaymentProviderAccount";

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

export async function markInvoicePaid(params: {
  invoice: IInvoice;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
}): Promise<IInvoice> {
  const { invoice, providerPaymentId, providerOrderId } = params;

  if (invoice.status === "paid") {
    return invoice;
  }

  invoice.status = "paid";
  invoice.paidAt = new Date();
  if (providerPaymentId) invoice.providerPaymentId = providerPaymentId;
  if (providerOrderId) invoice.providerOrderId = providerOrderId;
  await invoice.save();

  logNotificationAsync({
    entityType: "invoice",
    action: "updated",
    entityId: String(invoice._id),
    customerRef: invoice.customerRef ?? null,
    summary: `Invoice ${invoice.number} paid`,
    actorType: "system",
    actorName: "System",
    metadata: {
      sourceType: invoice.sourceType,
      amountCents: invoice.amountCents,
    },
  });

  if (
    (invoice.sourceType === "contract_renewal" ||
      invoice.sourceType === "contract_initial") &&
    invoice.contractRef
  ) {
    const contract = await Contract.findById(invoice.contractRef);
    if (contract && invoice.sourceType === "contract_renewal") {
      const durationMonths =
        typeof invoice.metadata?.durationMonths === "number"
          ? invoice.metadata.durationMonths
          : contract.durationMonths || 12;

      // Avoid double-renewing if already linked to this invoice
      const already = contract.renewals.some(
        (r) => r.invoiceRef && String(r.invoiceRef) === String(invoice._id),
      );
      if (!already) {
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
        (id): id is string => Boolean(id) && Types.ObjectId.isValid(id),
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

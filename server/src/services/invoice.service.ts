import { Types } from "mongoose";
import { Contract, IContract } from "../models/mongo/Contract";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  computeRenewalDueDateAfterRenewal,
  parseDateOnly,
  startOfDay,
} from "../utils/contractDates";
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
  if (params.invoiceId && Types.ObjectId.isValid(params.invoiceId)) {
    const byId = await Invoice.findById(params.invoiceId);
    if (byId) return byId;
  }
  if (params.providerPaymentId) {
    const byPayment = await Invoice.findOne({
      providerPaymentId: params.providerPaymentId,
    });
    if (byPayment) return byPayment;
  }
  if (params.providerOrderId) {
    const byOrder = await Invoice.findOne({
      providerOrderId: params.providerOrderId,
    });
    if (byOrder) return byOrder;
  }
  return null;
}

export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

export async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `INV-${year}-`;
  const latest = await Invoice.findOne({ number: new RegExp(`^${prefix}`) })
    .sort({ number: -1 })
    .select("number")
    .lean();

  let seq = 1;
  if (latest?.number) {
    const part = latest.number.slice(prefix.length);
    const n = parseInt(part, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

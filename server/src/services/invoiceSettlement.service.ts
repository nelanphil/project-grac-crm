import { CustomerContact, activeContactFilter } from "../models/mongo/CustomerContact";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { resolvePublicApiBase } from "../utils/publicUrl";
import { finalizeRedemptionsForInvoices } from "./discount.service";
import { markInvoicePaid } from "./invoice.service";
import { textInvoiceReceipt } from "./invoiceReceipt.service";
import { sendPaymentReceipt } from "./paymentReceipt.service";

type SettleActor = {
  actorType?: "user" | "system";
  actorUserId?: string | null;
  actorName?: string | null;
};

/** Ten US digits from a stored contact phone, or "" when it is not a US number. */
export function receiptPhoneDigits(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

async function sendPaymentReceiptText(invoice: IInvoice, apiBase: string): Promise<void> {
  if (!invoice.customerRef) return;
  const claimed = await Invoice.findOneAndUpdate(
    { _id: invoice._id, status: "paid", paymentReceiptTextSentAt: null },
    { $set: { paymentReceiptTextSentAt: new Date() } },
    { new: true },
  );
  if (!claimed) return;

  const release = () =>
    Invoice.updateOne(
      { _id: invoice._id },
      { $set: { paymentReceiptTextSentAt: null } },
    );

  try {
    const contacts = await CustomerContact.find({
      customerRef: invoice.customerRef,
      ...activeContactFilter,
    })
      .sort({ isPrimary: -1, createdAt: 1 })
      .select("_id phone");
    const contact = contacts.find((item) => receiptPhoneDigits(item.phone));
    if (!contact) {
      await release();
      console.info(`[payment-receipt] No textable phone for invoice ${invoice.number}`);
      return;
    }
    const result = await textInvoiceReceipt({
      invoice: claimed,
      phone: receiptPhoneDigits(contact.phone),
      contactId: String(contact._id),
      apiBase,
    });
    if (result.status !== "sent") {
      await release();
      console.error(
        `[payment-receipt] Text failed for invoice ${invoice.number}:`,
        result.status === "failed" ? result.error : "invalid phone",
      );
    }
  } catch (err) {
    await release();
    console.error(`[payment-receipt] Text failed for invoice ${invoice.number}:`, err);
  }
}

function paidBySamePayment(
  invoice: IInvoice,
  payment: { providerPaymentId?: string | null; providerOrderId?: string | null },
): boolean {
  return Boolean(
    (payment.providerPaymentId &&
      invoice.providerPaymentId === payment.providerPaymentId) ||
      (payment.providerOrderId && invoice.providerOrderId === payment.providerOrderId),
  );
}

/** Indirection so tests can stub the database and messaging side effects. */
export const settlementEffects = {
  finalizeRedemptions: finalizeRedemptionsForInvoices,
  async sendReceipts(invoice: IInvoice, apiBase: string): Promise<void> {
    await sendPaymentReceipt(invoice);
    await sendPaymentReceiptText(invoice, apiBase);
  },
};

/**
 * Marks invoices paid after a provider confirms the charge, then finalizes discounts and
 * sends the customer the receipt email and text. Safe to call again for the same payment:
 * each receipt is claimed once on the invoice.
 */
export async function settleInvoicePayment(params: {
  invoices: IInvoice[];
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  actor?: SettleActor;
  paidByCustomer?: boolean;
  apiBase?: string;
}): Promise<IInvoice[]> {
  const settled: IInvoice[] = [];
  for (const invoice of params.invoices) {
    if (invoice.status === "void") continue;
    if (invoice.status === "paid") {
      if (!paidBySamePayment(invoice, params)) continue;
      if (invoice.paymentReceiptSentAt && invoice.paymentReceiptTextSentAt) continue;
    }
    if (invoice.posCharge && invoice.posCharge.status !== "confirmed") {
      invoice.posCharge.status = "confirmed";
      invoice.posCharge.reviewReason = null;
      invoice.markModified("posCharge");
    }
    settled.push(
      await markInvoicePaid({
        invoice,
        providerPaymentId: params.providerPaymentId,
        providerOrderId: params.providerOrderId,
        actor: params.actor,
        paidByCustomer: params.paidByCustomer,
      }),
    );
  }
  for (const invoice of settled) {
    if (invoice.isModified()) await invoice.save();
  }
  if (settled.length === 0) return settled;

  await settlementEffects.finalizeRedemptions(
    settled.map((invoice) => String(invoice._id)),
  );
  const apiBase = params.apiBase || resolvePublicApiBase();
  for (const invoice of settled) {
    try {
      await settlementEffects.sendReceipts(invoice, apiBase);
    } catch (err) {
      console.error(`[payment-receipt] Failed for invoice ${invoice.number}:`, err);
    }
  }
  return settled;
}

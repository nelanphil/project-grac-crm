import { Types } from "mongoose";
import { listVisibleWorkOrderNotes } from "../controllers/workOrderNote.controller";
import { Contract } from "../models/mongo/Contract";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { ensureDefaultInvoiceTemplate } from "../models/mongo/InvoiceTemplate";
import {
  includingDeletedWorkOrders,
  WorkOrder,
} from "../models/mongo/WorkOrder";
import {
  invoiceBlocksSchema,
  sanitizeInvoiceBlocks,
} from "../schemas/invoiceTemplate.schema";
import { sendRoleEmail } from "./email.service";
import { isEmailChannelEnabled } from "../utils/emailPreferences";
import {
  renderInvoiceTemplateEmail,
  type InvoiceTemplateEmailDocument,
} from "../utils/invoiceTemplateEmail";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";
import {
  buildUnsubscribeUrl,
  listUnsubscribeHeaders,
} from "../utils/unsubscribeToken";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function customerDisplayName(customer: {
  accountName?: string;
  first?: string;
  last?: string;
}): string {
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  return `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
}

function pickRecipient(primaryEmail: string, accountEmail: string): string {
  const primary = normalizeAccountEmail(primaryEmail);
  const account = normalizeAccountEmail(accountEmail);
  if (EMAIL_RE.test(primary)) return primary;
  if (EMAIL_RE.test(account)) return account;
  return "";
}

export async function loadInvoiceEmailContext(invoice: IInvoice): Promise<{
  document: InvoiceTemplateEmailDocument;
  recipient: string;
}> {
  const resolvedCustomer = invoice.customerRef
    ? await Customer.findById(invoice.customerRef).lean()
    : typeof invoice.customerId === "number"
      ? await Customer.findOne({
          legacyId: invoice.customerId,
          deletedAt: null,
          $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
        }).lean()
      : null;

  let customer: InvoiceTemplateEmailDocument["customer"] = null;
  let recipient = "";
  if (resolvedCustomer) {
    const primaryContact = await CustomerContact.findOne({
      customerRef: resolvedCustomer._id,
      isPrimary: true,
    })
      .select("phone email")
      .lean();
    const phone = (primaryContact?.phone || resolvedCustomer.phone || "").trim();
    const email = (primaryContact?.email || resolvedCustomer.email || "").trim();
    recipient = pickRecipient(primaryContact?.email ?? "", resolvedCustomer.email ?? "");
    customer = {
      name:
        customerDisplayName(resolvedCustomer) ||
        `Customer #${resolvedCustomer.legacyId ?? invoice.customerId}`,
      address: resolvedCustomer.address ?? "",
      city: resolvedCustomer.city ?? "",
      state: resolvedCustomer.state ?? "",
      zip: resolvedCustomer.zip ?? "",
      phone,
      email,
    };
  }

  let addressRef: Types.ObjectId | null | undefined;
  if (invoice.contractRef) {
    const contract = await Contract.findById(invoice.contractRef)
      .select("addressRef")
      .lean();
    addressRef = contract?.addressRef ?? null;
  } else if (invoice.workOrderRef) {
    const workOrder = await includingDeletedWorkOrders(
      WorkOrder.findById(invoice.workOrderRef).select("addressRef"),
    ).lean();
    addressRef = workOrder?.addressRef ?? null;
  }

  let serviceAddress: InvoiceTemplateEmailDocument["serviceAddress"] = null;
  if (addressRef) {
    const site = await CustomerAddress.findById(addressRef).lean();
    if (site) {
      serviceAddress = {
        label: site.label || undefined,
        address: site.address ?? "",
        city: site.city ?? "",
        state: site.state ?? "",
        zip: site.zip ?? "",
      };
    }
  }

  const workOrderNotes = invoice.workOrderRef
    ? (await listVisibleWorkOrderNotes(invoice.workOrderRef)).map((note) => ({
        content: note.content,
      }))
    : [];

  return {
    recipient,
    document: {
      number: invoice.number,
      customerId: invoice.customerId,
      sourceType: invoice.sourceType,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      paymentProvider: invoice.paymentProvider ?? null,
      lineItems: invoice.lineItems.map((item) => ({
        description: item.description,
        amountCents: item.amountCents,
      })),
      amountCents: invoice.amountCents,
      originalAmountCents: invoice.originalAmountCents ?? null,
      discountCode: invoice.discountCode ?? null,
      discountCents: invoice.discountCents ?? 0,
      taxRatePercent: invoice.taxRatePercent ?? 0,
      taxCents: invoice.taxCents ?? 0,
      customer,
      serviceAddress,
      workOrderNotes,
    },
  };
}

async function deliverPaymentReceipt(invoice: IInvoice): Promise<void> {
  const fresh = await Invoice.findById(invoice._id);
  if (!fresh || fresh.status !== "paid") return;

  const template = await ensureDefaultInvoiceTemplate();
  const parsed = invoiceBlocksSchema.safeParse(template.blocks);
  if (!parsed.success) {
    console.error(
      "[payment-receipt] Default invoice template is invalid",
      parsed.error.flatten(),
    );
    return;
  }

  const { document, recipient } = await loadInvoiceEmailContext(fresh);
  if (!recipient) {
    console.info(`[payment-receipt] No billing email for invoice ${fresh.number}`);
    return;
  }
  if (!(await isEmailChannelEnabled(recipient, "billing"))) {
    console.info(
      `[payment-receipt] Billing alerts off for ${recipient}; skipped invoice ${fresh.number}`,
    );
    return;
  }

  const claimed = await Invoice.findOneAndUpdate(
    { _id: fresh._id, paymentReceiptSentAt: null },
    { $set: { paymentReceiptSentAt: new Date() } },
  );
  if (!claimed) return;

  try {
    const rendered = renderInvoiceTemplateEmail({
      blocks: sanitizeInvoiceBlocks(parsed.data),
      invoice: document,
      unsubscribeUrl: buildUnsubscribeUrl(recipient, "billing"),
    });
    await sendRoleEmail("billing_notifications", {
      to: recipient,
      subject: `Payment received for invoice ${fresh.number}`,
      text: rendered.text,
      html: rendered.html,
      headers: listUnsubscribeHeaders(recipient, "billing"),
    });
  } catch (err) {
    await Invoice.updateOne(
      { _id: fresh._id },
      { $set: { paymentReceiptSentAt: null } },
    );
    throw err;
  }
}

/** Email the live default invoice template. Never throws; payment stays paid. */
export async function sendPaymentReceipt(invoice: IInvoice): Promise<void> {
  try {
    await deliverPaymentReceipt(invoice);
  } catch (err) {
    console.error(`[payment-receipt] Failed for invoice ${invoice.number}:`, err);
  }
}

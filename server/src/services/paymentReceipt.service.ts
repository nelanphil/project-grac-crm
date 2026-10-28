import { Types } from "mongoose";
import { listVisibleWorkOrderNotes } from "../controllers/workOrderNote.controller";
import { Contract } from "../models/mongo/Contract";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
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
import { resolveAutomatedMessage } from "./automatedMessage.service";
import { resolveInvoiceWidget } from "./invoiceWidget.service";
import { isEmailChannelEnabled } from "../utils/emailPreferences";
import { buildStaffOutboundEmail } from "../utils/emailTemplates";
import {
  mergeEmailChrome,
  renderEmailChrome,
  type EmailChrome,
} from "../utils/emailChrome";
import {
  renderMessageTemplate,
  templateUsesInvoice,
} from "../utils/messageTemplate";
import { buildTemplateContextForContact } from "../utils/messagingContext";
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

export async function renderAutomatedBillingEmail(input: {
  subject: string;
  body: string;
  emailChrome?: EmailChrome | null;
  invoiceId: string;
  customerRef?: Types.ObjectId | string | null;
  recipient: string;
}): Promise<{ subject: string; text: string; html: string }> {
  let context: Record<string, string> = { first_name: "" };
  const customerRef = input.customerRef ? String(input.customerRef) : "";
  if (customerRef && Types.ObjectId.isValid(customerRef)) {
    const contact = await CustomerContact.findOne({
      customerRef,
      ...activeContactFilter,
    })
      .sort({ isPrimary: -1, createdAt: 1 })
      .select("_id");
    if (contact) {
      const built = await buildTemplateContextForContact(String(contact._id));
      if (built) context = built.context;
    }
  }

  const render = (value: string) => renderMessageTemplate(value, context);
  const subject = render(input.subject);
  const body = render(input.body);
  const chrome = renderEmailChrome(mergeEmailChrome(input.emailChrome), render);
  const invoiceWidget = templateUsesInvoice(
    input.subject,
    input.body,
    chrome.headerHtml,
    chrome.footerHtml,
  )
    ? await resolveInvoiceWidget({
        invoiceId: input.invoiceId,
        sampleFallback: false,
      })
    : null;

  return buildStaffOutboundEmail({
    subject,
    bodyText: body,
    chrome,
    unsubscribeUrl: buildUnsubscribeUrl(input.recipient, "billing"),
    invoiceWidget,
  });
}

async function deliverPaymentReceipt(invoice: IInvoice): Promise<void> {
  const fresh = await Invoice.findById(invoice._id);
  if (!fresh || fresh.status !== "paid") return;

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

  const copy = await resolveAutomatedMessage("paymentReceivedEmail", {
    number: fresh.number,
    amountCents: fresh.amountCents,
    dueDate: fresh.dueDate,
    record: fresh,
  });

  let rendered: { subject: string; text: string; html: string };
  if (copy.useInvoiceDocument) {
    const template = await ensureDefaultInvoiceTemplate();
    const parsed = invoiceBlocksSchema.safeParse(template.blocks);
    if (!parsed.success) {
      console.error(
        "[payment-receipt] Default invoice template is invalid",
        parsed.error.flatten(),
      );
      return;
    }
    const documentEmail = renderInvoiceTemplateEmail({
      blocks: sanitizeInvoiceBlocks(parsed.data),
      invoice: document,
      unsubscribeUrl: buildUnsubscribeUrl(recipient, "billing"),
    });
    rendered = { ...documentEmail, subject: copy.subject };
  } else {
    rendered = await renderAutomatedBillingEmail({
      subject: copy.subject,
      body: copy.body,
      emailChrome: copy.emailChrome,
      invoiceId: String(fresh._id),
      customerRef: fresh.customerRef,
      recipient,
    });
  }

  const claimed = await Invoice.findOneAndUpdate(
    { _id: fresh._id, paymentReceiptSentAt: null },
    { $set: { paymentReceiptSentAt: new Date() } },
  );
  if (!claimed) return;

  try {
    await sendRoleEmail("billing_notifications", {
      to: recipient,
      subject: rendered.subject,
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

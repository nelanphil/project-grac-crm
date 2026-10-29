import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { ensureDefaultInvoiceTemplate } from "../models/mongo/InvoiceTemplate";
import {
  invoiceBlocksSchema,
  sanitizeInvoiceBlocks,
} from "../schemas/invoiceTemplate.schema";
import { dispatchMessagingBatch } from "../controllers/messaging.controller";
import { sendRoleEmail } from "./email.service";
import {
  loadInvoiceEmailContext,
  renderAutomatedBillingEmail,
} from "./paymentReceipt.service";
import {
  automatedEmailPauseReasonFor,
  resolveAutomatedMessage,
} from "./automatedMessage.service";
import { renderMessageTemplate } from "../utils/messageTemplate";
import {
  getTwilioAccountForSend,
  sendSms,
  TwilioServiceError,
} from "./twilio.service";
import { isTenDigitUsPhone } from "./workOrderCompletion.service";
import { isEmailChannelEnabled } from "../utils/emailPreferences";
import { isSmsEnabled } from "../utils/smsPreferences";
import { contactHasValidEmail, toE164 } from "../utils/messagingContext";
import { renderInvoiceTemplateEmail } from "../utils/invoiceTemplateEmail";
import { normalizePhoneLines } from "../utils/twilioPhoneLines";
import {
  buildUnsubscribeUrl,
  listUnsubscribeHeaders,
} from "../utils/unsubscribeToken";
import {
  buildInvoiceViewUrl,
  ensureInvoiceViewToken,
} from "../utils/checkoutKey";

export type InvoiceEmailReceiptResult =
  | { status: "sent"; to: string }
  | { status: "missing" }
  | { status: "invalid"; to: string }
  | { status: "skipped"; error: string }
  | { status: "failed"; error: string };

export type InvoiceTextReceiptResult =
  | { status: "sent"; to: string }
  | { status: "invalid" }
  | { status: "failed"; error: string };

export function classifyReceiptEmail(
  raw: string | null | undefined,
): { status: "missing" } | { status: "invalid"; to: string } | { status: "ok"; to: string } {
  const to = (raw ?? "").trim().toLowerCase();
  if (!to) return { status: "missing" };
  if (!contactHasValidEmail(to)) return { status: "invalid", to };
  return { status: "ok", to };
}

export function classifyReceiptPhone(
  raw: string | null | undefined,
): { status: "invalid" } | { status: "ok"; phone: string } {
  const phone = (raw ?? "").trim();
  if (!isTenDigitUsPhone(phone)) return { status: "invalid" };
  return { status: "ok", phone };
}

async function smsFromNumber(): Promise<
  | { ok: true; account: Awaited<ReturnType<typeof getTwilioAccountForSend>>; from: string }
  | { ok: false; error: string }
> {
  try {
    const account = await getTwilioAccountForSend();
    const lines = normalizePhoneLines(account.phoneNumbers);
    const from = (lines.find((line) => line.sms) ?? lines[0])?.phoneNumber;
    if (!from) return { ok: false, error: "No texting number is configured." };
    return { ok: true, account, from };
  } catch (err) {
    const error =
      err instanceof TwilioServiceError
        ? err.message
        : err instanceof Error
          ? err.message
          : "No texting number is configured.";
    return { ok: false, error };
  }
}

export async function emailInvoiceReceipt(input: {
  invoice: IInvoice;
  to?: string;
}): Promise<InvoiceEmailReceiptResult> {
  const viewUrl = buildInvoiceViewUrl(await ensureInvoiceViewToken(input.invoice));
  let recipient = input.to?.trim() ?? "";
  if (!input.to?.trim()) {
    recipient = (await loadInvoiceEmailContext(input.invoice)).recipient;
  }
  const classified = classifyReceiptEmail(recipient);
  if (classified.status !== "ok") return classified;

  if (!(await isEmailChannelEnabled(classified.to, "billing"))) {
    return {
      status: "skipped",
      error: "This address is unsubscribed from billing emails.",
    };
  }
  const paused = await automatedEmailPauseReasonFor("paidInvoiceReceiptEmail");
  if (paused) return { status: "skipped", error: paused };

  try {
    const copy = await resolveAutomatedMessage("paidInvoiceReceiptEmail", {
      number: input.invoice.number,
      amountCents: input.invoice.amountCents,
      dueDate: input.invoice.dueDate,
      viewUrl,
      record: input.invoice,
    });
    let rendered: { subject: string; text: string; html: string };
    if (copy.useInvoiceDocument) {
      const template = await ensureDefaultInvoiceTemplate();
      const parsed = invoiceBlocksSchema.safeParse(template.blocks);
      if (!parsed.success) {
        return { status: "failed", error: "The invoice template could not be rendered." };
      }
      const { document } = await loadInvoiceEmailContext(input.invoice);
      const documentEmail = renderInvoiceTemplateEmail({
        blocks: sanitizeInvoiceBlocks(parsed.data),
        invoice: document,
        unsubscribeUrl: buildUnsubscribeUrl(classified.to, "billing"),
        viewUrl,
      });
      rendered = { ...documentEmail, subject: copy.subject };
    } else {
      rendered = await renderAutomatedBillingEmail({
        subject: copy.subject,
        body: copy.body,
        emailChrome: copy.emailChrome,
        invoiceId: String(input.invoice._id),
        customerRef: input.invoice.customerRef,
        recipient: classified.to,
      });
    }
    await sendRoleEmail("billing_notifications", {
      to: classified.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: listUnsubscribeHeaders(classified.to, "billing"),
    });
    await Invoice.updateOne(
      { _id: input.invoice._id },
      { $set: { paymentReceiptSentAt: new Date() } },
    );
    return { status: "sent", to: classified.to };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "The email was not sent.",
    };
  }
}

export async function textInvoiceReceipt(input: {
  invoice: IInvoice;
  phone: string;
  contactId?: string | null;
  userId?: string | null;
  apiBase: string;
}): Promise<InvoiceTextReceiptResult> {
  const phone = classifyReceiptPhone(input.phone);
  if (phone.status !== "ok") return { status: "invalid" };

  const viewUrl = buildInvoiceViewUrl(await ensureInvoiceViewToken(input.invoice));
  const copy = await resolveAutomatedMessage("paidInvoiceReceiptSms", {
    number: input.invoice.number,
    amountCents: input.invoice.amountCents,
    dueDate: input.invoice.dueDate,
    viewUrl,
    record: input.invoice,
  });
  const line = await smsFromNumber();
  if (!line.ok) return { status: "failed", error: line.error };

  const contact = input.contactId
    ? await CustomerContact.findOne({
        _id: input.contactId,
        ...activeContactFilter,
      }).select("_id")
    : input.invoice.customerRef
      ? await CustomerContact.findOne({
          customerRef: input.invoice.customerRef,
          ...activeContactFilter,
        })
          .sort({ isPrimary: -1, createdAt: 1 })
          .select("_id")
      : null;

  try {
    if (contact) {
      const result = await dispatchMessagingBatch(
        {
          contactIds: [String(contact._id)],
          body: copy.body,
          mediaUrls: [],
          twilioAccountId: String(line.account._id),
          fromNumber: line.from,
          includePaymentLink: false,
          toOverride: phone.phone,
        },
        { userId: input.userId ?? null, apiBase: input.apiBase },
      );
      const item = result.results[0];
      if (item?.status === "sent") return { status: "sent", to: phone.phone };
      return { status: "failed", error: item?.error || "The text was not sent." };
    }

    const to = toE164(phone.phone);
    if (!to) return { status: "invalid" };
    if (!(await isSmsEnabled(phone.phone))) {
      return {
        status: "failed",
        error: "Recipient opted out of text messages",
      };
    }
    await sendSms({
      account: line.account,
      from: line.from,
      to,
      body: renderMessageTemplate(copy.body, { first_name: "" }),
    });
    return { status: "sent", to: phone.phone };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "The text was not sent.",
    };
  }
}

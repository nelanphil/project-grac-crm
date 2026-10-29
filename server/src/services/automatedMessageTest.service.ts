import { env } from "../config/env";
import {
  recommendedDatesEmailHtml,
  recommendedDatesEmailText,
} from "./renewalScheduleChoice";
import { sendRoleEmail } from "./email.service";
import {
  AutomatedMessageError,
  resolveDraftAutomatedMessage,
} from "./automatedMessage.service";
import {
  classifyReceiptEmail,
  classifyReceiptPhone,
} from "./invoiceReceipt.service";
import { ensureDefaultInvoiceTemplate } from "../models/mongo/InvoiceTemplate";
import {
  invoiceBlocksSchema,
  sanitizeInvoiceBlocks,
} from "../schemas/invoiceTemplate.schema";
import type {
  PreviewAutomatedMessageInput,
  TestAutomatedMessageInput,
} from "../schemas/automatedMessage.schema";
import { buildStaffOutboundEmail } from "../utils/emailTemplates";
import {
  renderInvoiceTemplateEmail,
  renderInvoiceTemplateFragment,
  type InvoiceTemplateEmailDocument,
} from "../utils/invoiceTemplateEmail";
import { SAMPLE_INVOICE_EMAIL_DOCUMENT } from "./invoiceWidget.service";
import {
  applyInvoiceTokens,
  AUTOMATED_MESSAGE_KIND,
  formatMailboxReplyHtml,
  type AutomatedMessageChannelKey,
  type ResolvedAutomatedMessage,
} from "../utils/automatedMessageCopy";
import {
  SAMPLE_TEMPLATE_CONTEXT,
  renderMessageTemplate,
  stripInvoiceToken,
  templateUsesInvoice,
  type MessageTemplateContext,
} from "../utils/messageTemplate";
import { composeSmsPaymentBody } from "../utils/smsPaymentLink";
import { buildReplyEmail, replySubject } from "../utils/mailboxReply";
import {
  buildUnsubscribeUrl,
  listUnsubscribeHeaders,
} from "../utils/unsubscribeToken";
import {
  getTwilioAccountForSend,
  sendSms,
  TwilioServiceError,
} from "./twilio.service";
import { normalizePhoneLines } from "../utils/twilioPhoneLines";
import { toE164 } from "../utils/messagingContext";

const SAMPLE_PAID_AT = "2026-03-20T15:00:00.000Z";
const SAMPLE_PREVIEW_RECIPIENT = "jordan.lee@example.com";
const SAMPLE_QUOTE =
  "Can you confirm the service appointment for the generator?";

export function automatedTestPayUrl(): string {
  return `${env.clientUrl.replace(/\/$/, "")}/pay/sample`;
}

export function automatedTestViewUrl(): string {
  return `${env.clientUrl.replace(/\/$/, "")}/invoice/?t=sample`;
}

export function sampleAutomatedInvoice(
  paid: boolean,
): InvoiceTemplateEmailDocument {
  if (!paid) return SAMPLE_INVOICE_EMAIL_DOCUMENT;
  return {
    ...SAMPLE_INVOICE_EMAIL_DOCUMENT,
    status: "paid",
    paidAt: SAMPLE_PAID_AT,
  };
}

export function prefixAutomatedTestSubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "[Test]";
  if (/^\[test\]/i.test(trimmed)) return trimmed;
  return `[Test] ${trimmed}`;
}

export type AutomatedTestRenderers = {
  renderDocument: (input: {
    invoice: InvoiceTemplateEmailDocument;
    viewUrl?: string;
    unsubscribeUrl?: string;
  }) => Promise<{ html: string; text: string }>;
  renderWidget: (
    invoice: InvoiceTemplateEmailDocument,
  ) => Promise<{ html: string; text: string }>;
};

export type ComposedAutomatedMessageTest = {
  kind: "email" | "sms";
  subject: string;
  text: string;
  html: string;
  smsBody: string;
  invoiceStatus: "open" | "paid" | null;
  paymentUrl: string | null;
};

async function defaultRenderers(): Promise<AutomatedTestRenderers> {
  const template = await ensureDefaultInvoiceTemplate();
  const parsed = invoiceBlocksSchema.safeParse(template.blocks);
  if (!parsed.success) {
    throw new AutomatedMessageError(
      "The invoice template could not be rendered.",
      500,
    );
  }
  const blocks = sanitizeInvoiceBlocks(parsed.data);
  return {
    renderDocument: async (input) =>
      renderInvoiceTemplateEmail({
        blocks,
        invoice: input.invoice,
        unsubscribeUrl: input.unsubscribeUrl,
        viewUrl: input.viewUrl,
      }),
    renderWidget: async (invoice) =>
      renderInvoiceTemplateFragment({ blocks, invoice }),
  };
}

function invoiceTokens(viewUrl: string) {
  const invoice = SAMPLE_INVOICE_EMAIL_DOCUMENT;
  return {
    number: invoice.number,
    amountCents: invoice.amountCents,
    dueDate: invoice.dueDate,
    viewUrl,
  };
}

function appointmentSample(channel: AutomatedMessageChannelKey) {
  if (
    channel !== "appointmentConfirmationEmail" &&
    channel !== "appointmentConfirmationSms"
  ) {
    return {};
  }
  return {
    appointmentDate: "Thursday, November 5",
    appointmentTime: " at 9:00 AM",
    technicianName: "Sam Rivera",
    serviceAddress: "123 Oak Street, Tampa, FL 33601",
  };
}

function sampleContext(paymentUrl: string | null): MessageTemplateContext {
  return {
    ...SAMPLE_TEMPLATE_CONTEXT,
    payment_link: paymentUrl ?? "",
  };
}

export async function composeAutomatedMessageTest(
  input: {
    channel: AutomatedMessageChannelKey;
    resolved: ResolvedAutomatedMessage;
    recipient: string;
    /** When false, the subject is the customer-facing line with no [Test] prefix. */
    testLabel?: boolean;
    /** Renewal emails only. Defaults to showing sample date buttons. */
    includeRecommendedDates?: boolean;
  },
  renderers?: AutomatedTestRenderers,
): Promise<ComposedAutomatedMessageTest> {
  const kind = AUTOMATED_MESSAGE_KIND[input.channel];
  const paidInvoice =
    kind === "receipt-email" || input.channel === "renewalScheduleEmail";
  const invoice = sampleAutomatedInvoice(paidInvoice);
  const invoiceStatus: ComposedAutomatedMessageTest["invoiceStatus"] =
    kind === "mailbox" || kind === "sms"
      ? null
      : paidInvoice
        ? "paid"
        : "open";

  if (kind === "mailbox") {
    const bodyHtml = formatMailboxReplyHtml(
      stripInvoiceToken(
        renderMessageTemplate(input.resolved.body, sampleContext(null)),
      ),
    );
    const email = buildReplyEmail({
      bodyHtml,
      useBrandTemplate: false,
      quote: {
        mode: "reply",
        original: {
          html: `<p>${SAMPLE_QUOTE}</p>`,
          text: SAMPLE_QUOTE,
          from: [{ name: "Jordan Lee", address: "jordan.lee@example.com" }],
          to: [
            {
              name: "Generator Maintenance of Florida",
              address: "contact@genmaintoffl.com",
            },
          ],
          date: "2026-03-15T14:00:00.000Z",
          subject: "Generator service",
        },
      },
    });
    const originalSubject =
      input.testLabel === false
        ? "Generator service"
        : "[Test] Generator service";
    return {
      kind: "email",
      subject: replySubject(originalSubject, "reply"),
      text: email.text,
      html: email.html,
      smsBody: "",
      invoiceStatus: null,
      paymentUrl: null,
    };
  }

  if (kind === "sms") {
    const includePaymentLink = input.channel === "workOrderCompleteSms";
    const paymentUrl = includePaymentLink ? automatedTestPayUrl() : null;
    const composed = composeSmsPaymentBody({
      bodyTemplate: applyInvoiceTokens(input.resolved.body, {
        ...invoiceTokens(automatedTestViewUrl()),
        ...appointmentSample(input.channel),
      }),
      context: sampleContext(paymentUrl),
      includePaymentLink,
      paymentUrl,
    });
    if (composed.error) {
      throw new AutomatedMessageError(composed.error, 400);
    }
    return {
      kind: "sms",
      subject: "",
      text: "",
      html: "",
      smsBody: composed.body,
      invoiceStatus: null,
      paymentUrl,
    };
  }

  const renewal = input.channel === "renewalScheduleEmail";
  const sampleDates =
    renewal && input.includeRecommendedDates !== false
      ? {
          pageUrl: `${env.clientUrl.replace(/\/$/, "")}/schedule-renewal`,
          token: "sample",
          dates: ["2026-11-03", "2026-11-05", "2026-11-10"],
        }
      : null;
  const tokens = {
    ...invoiceTokens(automatedTestViewUrl()),
    ...(renewal ? { contractType: "ASC" } : {}),
    ...appointmentSample(input.channel),
  };
  const renderedSubject = renderMessageTemplate(
    applyInvoiceTokens(input.resolved.subject, tokens),
    sampleContext(null),
  );
  const subject =
    input.testLabel === false
      ? renderedSubject
      : prefixAutomatedTestSubject(renderedSubject);

  if (input.resolved.useInvoiceDocument) {
    const active = renderers ?? (await defaultRenderers());
    const viewUrl =
      input.channel === "paidInvoiceReceiptEmail"
        ? automatedTestViewUrl()
        : undefined;
    const rendered = await active.renderDocument({
      invoice,
      viewUrl,
      unsubscribeUrl: buildUnsubscribeUrl(input.recipient, "billing"),
    });
    return {
      kind: "email",
      subject,
      text: rendered.text,
      html: rendered.html,
      smsBody: "",
      invoiceStatus,
      paymentUrl: null,
    };
  }

  const paymentUrl =
    input.channel === "workOrderCompleteEmail" ? automatedTestPayUrl() : null;
  const context = sampleContext(paymentUrl);
  const body = renderMessageTemplate(
    applyInvoiceTokens(input.resolved.body, tokens),
    context,
  );
  const chrome = input.resolved.emailChrome;
  const wantsWidget = templateUsesInvoice(
    input.resolved.subject,
    input.resolved.body,
    chrome?.headerHtml,
    chrome?.footerHtml,
  );
  const widget = wantsWidget
    ? await (renderers ?? (await defaultRenderers())).renderWidget(invoice)
    : null;
  const built = buildStaffOutboundEmail({
    subject,
    bodyText: body,
    paymentUrl: paymentUrl ?? undefined,
    paymentButtonLabel: "Pay this invoice",
    chrome: chrome ?? undefined,
    unsubscribeUrl: buildUnsubscribeUrl(input.recipient, "billing"),
    invoiceWidget: widget,
    recommendedDates: sampleDates
      ? {
          html: recommendedDatesEmailHtml(sampleDates),
          text: recommendedDatesEmailText(sampleDates),
        }
      : null,
  });
  return {
    kind: "email",
    subject: built.subject,
    text: built.text,
    html: built.html,
    smsBody: "",
    invoiceStatus,
    paymentUrl,
  };
}

async function textingLine() {
  try {
    const account = await getTwilioAccountForSend();
    const lines = normalizePhoneLines(account.phoneNumbers);
    const from = (lines.find((line) => line.sms) ?? lines[0])?.phoneNumber;
    if (!from) {
      throw new AutomatedMessageError("No texting number is configured.", 400);
    }
    return { account, from };
  } catch (err) {
    if (err instanceof AutomatedMessageError) throw err;
    const message =
      err instanceof TwilioServiceError
        ? err.message
        : err instanceof Error
          ? err.message
          : "No texting number is configured.";
    throw new AutomatedMessageError(message, 400);
  }
}

export async function sendAutomatedMessageTest(
  input: TestAutomatedMessageInput,
): Promise<{ message: string }> {
  const resolved = await resolveDraftAutomatedMessage(input.channel, input);
  if (AUTOMATED_MESSAGE_KIND[input.channel] === "sms") {
    const phone = classifyReceiptPhone(input.to);
    if (phone.status !== "ok") {
      throw new AutomatedMessageError("Enter a 10-digit phone number.");
    }
    const destination = toE164(phone.phone);
    if (!destination) {
      throw new AutomatedMessageError("Enter a 10-digit phone number.");
    }
    const composed = await composeAutomatedMessageTest({
      channel: input.channel,
      resolved,
      recipient: phone.phone,
    });
    const line = await textingLine();
    try {
      await sendSms({
        account: line.account,
        from: line.from,
        to: destination,
        body: composed.smsBody,
      });
    } catch (err) {
      if (err instanceof TwilioServiceError) {
        throw new AutomatedMessageError(err.message, 400);
      }
      throw err;
    }
    return { message: `Test text sent to ${phone.phone}.` };
  }

  const email = classifyReceiptEmail(input.to);
  if (email.status !== "ok") {
    throw new AutomatedMessageError("Enter a valid email address.");
  }
  const composed = await composeAutomatedMessageTest({
    channel: input.channel,
    resolved,
    recipient: email.to,
  });
  try {
    await sendRoleEmail("billing_notifications", {
      to: email.to,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
      headers:
        input.channel === "mailboxReply"
          ? undefined
          : listUnsubscribeHeaders(email.to, "billing"),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The email was not sent.";
    throw new AutomatedMessageError(message, 400);
  }
  return { message: `Test email sent to ${email.to}.` };
}

export async function previewAutomatedMessage(
  input: PreviewAutomatedMessageInput,
): Promise<
  Pick<ComposedAutomatedMessageTest, "kind" | "subject" | "html" | "smsBody">
> {
  const resolved = await resolveDraftAutomatedMessage(input.channel, input);
  const composed = await composeAutomatedMessageTest({
    channel: input.channel,
    resolved,
    recipient: SAMPLE_PREVIEW_RECIPIENT,
    testLabel: false,
    includeRecommendedDates:
      input.channel === "renewalScheduleEmail"
        ? input.offerRecommendedDates !== false
        : undefined,
  });
  return {
    kind: composed.kind,
    subject: composed.subject,
    html: composed.html,
    smsBody: composed.smsBody,
  };
}

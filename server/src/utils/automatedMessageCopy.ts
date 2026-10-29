import type { EmailChrome } from "./emailChrome";
import { looksLikeHtml, sanitizeEmailBody } from "./emailChrome";
import { RECEIPT_REPLY_HTML } from "./mailboxReply";

export const AUTOMATED_MESSAGE_CHANNELS = [
  "workOrderCompleteEmail",
  "workOrderCompleteSms",
  "paymentReceivedEmail",
  "paidInvoiceReceiptEmail",
  "paidInvoiceReceiptSms",
  "mailboxReply",
  "renewalScheduleEmail",
  "appointmentConfirmationEmail",
  "appointmentConfirmationSms",
] as const;

export type AutomatedMessageChannelKey =
  (typeof AUTOMATED_MESSAGE_CHANNELS)[number];

export type AutomatedMessageMode = "template" | "custom";

/** How a channel's custom wording is checked, and what a live template replaces. */
export type AutomatedMessageKind =
  | "email"
  | "sms"
  | "receipt-email"
  | "mailbox";

export const AUTOMATED_MESSAGE_KIND: Record<
  AutomatedMessageChannelKey,
  AutomatedMessageKind
> = {
  workOrderCompleteEmail: "email",
  workOrderCompleteSms: "sms",
  paymentReceivedEmail: "receipt-email",
  paidInvoiceReceiptEmail: "receipt-email",
  paidInvoiceReceiptSms: "sms",
  mailboxReply: "mailbox",
  renewalScheduleEmail: "email",
  appointmentConfirmationEmail: "email",
  appointmentConfirmationSms: "sms",
};

export const AUTOMATED_MESSAGE_DEFAULTS = {
  workOrderCompleteEmailSubject: "Invoice {{invoice_number}}",
  workOrderCompleteEmailBody: [
    "<p>Hi {{first_name}},</p>",
    "<p>Please find invoice <strong>{{invoice_number}}</strong> below.</p>",
    "<p>{{invoice}}</p>",
  ].join(""),
  workOrderCompleteSms:
    "Hi {{first_name}}, invoice {{invoice_number}} is ready. Total due: {{invoice_total}}. Due {{due_date}}.",
  paymentReceivedSubject: "Payment received for invoice {{invoice_number}}",
  paidInvoiceReceiptSubject: "Invoice {{invoice_number}}",
  paidInvoiceReceiptSms:
    "Hi {{first_name}}, thank you for your payment. View or download invoice {{invoice_number}}: {{invoice_view_url}}",
  mailboxReply: RECEIPT_REPLY_HTML,
  renewalScheduleEmailSubject: "Let's schedule your service visit",
  renewalScheduleEmailBody: [
    "<p>Hi {{first_name}},</p>",
    "<p>Thank you for renewing your {{contract_type}} agreement. Invoice {{invoice_number}} is paid.</p>",
    "<p>Choose a recommended date below, or call our office at (386) 631-8982 for immediate scheduling help.</p>",
    "{{recommended_dates}}",
  ].join(""),
  appointmentConfirmationSubject:
    "Your service appointment on {{appointment_date}}",
  appointmentConfirmationEmailBody: [
    "<p>Hi {{first_name}},</p>",
    "<p>Your service visit is scheduled for <strong>{{appointment_date}}</strong>{{appointment_time}} with {{technician_name}}.</p>",
    "<p>We will be at {{service_address}}.</p>",
    "<p>Reply to this email or call the office at (386) 631-8982 if you need a different time.</p>",
  ].join(""),
  appointmentConfirmationSms:
    "Hi {{first_name}}, your service visit is set for {{appointment_date}}{{appointment_time}} with {{technician_name}}. Address: {{service_address}}.",
} as const;

export const AUTOMATED_MESSAGE_FALLBACK: Record<
  AutomatedMessageChannelKey,
  { subject: string; body: string }
> = {
  workOrderCompleteEmail: {
    subject: AUTOMATED_MESSAGE_DEFAULTS.workOrderCompleteEmailSubject,
    body: AUTOMATED_MESSAGE_DEFAULTS.workOrderCompleteEmailBody,
  },
  workOrderCompleteSms: {
    subject: "",
    body: AUTOMATED_MESSAGE_DEFAULTS.workOrderCompleteSms,
  },
  paymentReceivedEmail: {
    subject: AUTOMATED_MESSAGE_DEFAULTS.paymentReceivedSubject,
    body: "",
  },
  paidInvoiceReceiptEmail: {
    subject: AUTOMATED_MESSAGE_DEFAULTS.paidInvoiceReceiptSubject,
    body: "",
  },
  paidInvoiceReceiptSms: {
    subject: "",
    body: AUTOMATED_MESSAGE_DEFAULTS.paidInvoiceReceiptSms,
  },
  mailboxReply: {
    subject: "",
    body: AUTOMATED_MESSAGE_DEFAULTS.mailboxReply,
  },
  renewalScheduleEmail: {
    subject: AUTOMATED_MESSAGE_DEFAULTS.renewalScheduleEmailSubject,
    body: AUTOMATED_MESSAGE_DEFAULTS.renewalScheduleEmailBody,
  },
  appointmentConfirmationEmail: {
    subject: AUTOMATED_MESSAGE_DEFAULTS.appointmentConfirmationSubject,
    body: AUTOMATED_MESSAGE_DEFAULTS.appointmentConfirmationEmailBody,
  },
  appointmentConfirmationSms: {
    subject: "",
    body: AUTOMATED_MESSAGE_DEFAULTS.appointmentConfirmationSms,
  },
};

export type AutomatedTemplateCopy = {
  subject: string;
  body: string;
  emailChrome?: EmailChrome | null;
};

export type AutomatedSavedChannel = {
  mode: AutomatedMessageMode;
  subject: string;
  body: string;
};

export type ResolvedAutomatedMessage = {
  subject: string;
  body: string;
  emailChrome?: EmailChrome | null;
  /** Receipt emails keep the Billing invoice document as the body. */
  useInvoiceDocument: boolean;
};

export type InvoiceTokenInput = {
  number?: string | null;
  amountCents?: number | null;
  dueDate?: Date | string | null;
  viewUrl?: string | null;
  contractType?: string | null;
  appointmentDate?: string | null;
  /** Includes a leading space and "at" or "between" when a time is known. */
  appointmentTime?: string | null;
  technicianName?: string | null;
  serviceAddress?: string | null;
};

const INVOICE_TOKEN_RE = (key: string) =>
  new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatInvoiceTotal(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatInvoiceDueDate(
  due: Date | string | null | undefined,
): string {
  if (!due) return "";
  const date = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function clearEmptyDueSentence(value: string): string {
  return value
    .replace(/<p>\s*Due\s*\.\s*<\/p>/gi, "")
    .replace(/[ \t]+Due[ \t]*\./g, "");
}

/** Fill invoice tokens. Contact tokens such as {{first_name}} stay in place. */
export function applyInvoiceTokens(
  template: string,
  invoice: InvoiceTokenInput,
): string {
  const html = looksLikeHtml(template);
  const encode = (value: string) => (html ? escapeHtml(value) : value);
  const number = invoice.number?.trim() || "invoice";
  const total =
    invoice.amountCents == null ? "" : formatInvoiceTotal(invoice.amountCents);
  const due = formatInvoiceDueDate(invoice.dueDate);
  const viewUrl = invoice.viewUrl?.trim() ?? "";
  let result = template
    .replace(INVOICE_TOKEN_RE("invoice_number"), encode(number))
    .replace(INVOICE_TOKEN_RE("invoice_total"), encode(total))
    .replace(INVOICE_TOKEN_RE("due_date"), encode(due))
    .replace(INVOICE_TOKEN_RE("invoice_view_url"), encode(viewUrl));
  if (invoice.contractType != null) {
    result = result.replace(
      INVOICE_TOKEN_RE("contract_type"),
      encode(invoice.contractType.trim()),
    );
  }
  if (invoice.appointmentDate != null) {
    result = result.replace(
      INVOICE_TOKEN_RE("appointment_date"),
      encode(invoice.appointmentDate),
    );
  }
  if (invoice.appointmentTime != null) {
    result = result.replace(
      INVOICE_TOKEN_RE("appointment_time"),
      encode(invoice.appointmentTime),
    );
  }
  if (invoice.technicianName != null) {
    result = result.replace(
      INVOICE_TOKEN_RE("technician_name"),
      encode(invoice.technicianName),
    );
  }
  if (invoice.serviceAddress != null) {
    result = result.replace(
      INVOICE_TOKEN_RE("service_address"),
      encode(invoice.serviceAddress),
    );
  }
  if (!due) result = clearEmptyDueSentence(result);
  return result;
}

export function templateUsesInvoiceViewUrl(
  ...parts: Array<string | undefined>
): boolean {
  return parts.some((part) =>
    Boolean(part && /\{\{\s*invoice_view_url\s*\}\}/.test(part)),
  );
}

function templateUsable(
  kind: AutomatedMessageKind,
  template: AutomatedTemplateCopy | null,
): template is AutomatedTemplateCopy {
  if (!template) return false;
  const body = template.body.trim();
  const subject = template.subject.trim();
  if (kind === "sms" || kind === "mailbox") return body.length > 0;
  return subject.length > 0 && body.length > 0;
}

function customUsable(
  kind: AutomatedMessageKind,
  subject: string,
  body: string,
): boolean {
  if (kind === "receipt-email") return subject.trim().length > 0;
  if (kind === "sms" || kind === "mailbox") return body.trim().length > 0;
  return subject.trim().length > 0 && body.trim().length > 0;
}

function fromTemplate(
  kind: AutomatedMessageKind,
  template: AutomatedTemplateCopy,
): ResolvedAutomatedMessage {
  if (kind === "mailbox" || kind === "sms") {
    return {
      subject: "",
      body: template.body,
      emailChrome: kind === "mailbox" ? undefined : template.emailChrome,
      useInvoiceDocument: false,
    };
  }
  return {
    subject: template.subject,
    body: template.body,
    emailChrome: template.emailChrome,
    useInvoiceDocument: false,
  };
}

function fromCustom(
  kind: AutomatedMessageKind,
  subject: string,
  body: string,
): ResolvedAutomatedMessage {
  return {
    subject,
    body: kind === "receipt-email" ? "" : body,
    useInvoiceDocument: kind === "receipt-email",
  };
}

function fromFallback(
  kind: AutomatedMessageKind,
  fallback: { subject: string; body: string },
): ResolvedAutomatedMessage {
  return fromCustom(kind, fallback.subject, fallback.body);
}

/**
 * Saved admin choice wins. A missing template falls back to that channel's
 * custom wording, then the original hardcoded copy. Until a channel is saved,
 * work-order messages can still use the invoice default template.
 */
export function resolveChannelCopy(input: {
  kind: AutomatedMessageKind;
  saved: AutomatedSavedChannel | null;
  selectedTemplate: AutomatedTemplateCopy | null;
  legacyTemplate: AutomatedTemplateCopy | null;
  fallback: { subject: string; body: string };
}): ResolvedAutomatedMessage {
  const { kind, saved, fallback } = input;
  if (saved) {
    if (
      saved.mode === "template" &&
      templateUsable(kind, input.selectedTemplate)
    ) {
      return fromTemplate(kind, input.selectedTemplate);
    }
    if (customUsable(kind, saved.subject, saved.body)) {
      return fromCustom(kind, saved.subject, saved.body);
    }
    return fromFallback(kind, fallback);
  }

  if (
    (kind === "email" || kind === "sms") &&
    templateUsable(kind, input.legacyTemplate)
  ) {
    return fromTemplate(kind, input.legacyTemplate);
  }
  return fromFallback(kind, fallback);
}

export function formatMailboxReplyHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return AUTOMATED_MESSAGE_DEFAULTS.mailboxReply;
  if (!looksLikeHtml(trimmed)) {
    const escaped = escapeHtml(trimmed).replace(/\n/g, "<br />");
    return `<p>${escaped}</p>`;
  }
  return sanitizeEmailBody(trimmed);
}

import { Types } from "mongoose";
import { CustomerContact, activeContactFilter } from "../models/mongo/CustomerContact";
import { EmailAccount } from "../models/mongo/EmailAccount";
import {
  INVOICE_MESSAGE_SETTINGS_SLUG,
  InvoiceMessageSettings,
} from "../models/mongo/InvoiceMessageSettings";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import type { IWorkOrder } from "../models/mongo/WorkOrder";
import { CheckoutError } from "./checkout.service";
import { createScopedPaymentLink } from "./checkoutLink.service";
import { dispatchStaffEmailBatch } from "./emailMessage.service";
import {
  dollarsToCents,
  findOpenInvoiceForWorkOrder,
  resolveCustomerRefForWorkOrder,
  syncWorkOrderInvoice,
  type WorkOrderInvoiceSource,
} from "./invoice.service";
import { dispatchMessagingBatch } from "../controllers/messaging.controller";
import {
  contactHasValidEmail,
  contactHasValidPhone,
} from "../utils/messagingContext";
import type { EmailChrome } from "../utils/emailChrome";
import { normalizePhoneLines } from "../utils/twilioPhoneLines";
import { getTwilioAccountForSend } from "./twilio.service";

export class WorkOrderCompletionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorkOrderCompletionError";
    this.status = status;
  }
}

export const ALREADY_COMPLETE_REASON = "This work order is already complete.";
export const INVOICE_NOT_OPEN_REASON =
  "This invoice is no longer open, so it cannot be resent.";
export const ZERO_TOTAL_REASON =
  "Add line items or a total before completing this work order.";
export const NO_CUSTOMER_REASON =
  "This work order has no customer, so it cannot be invoiced.";
export const NO_CONTACT_REASON =
  "This customer has no contact with a valid phone number or email. Add contact information before marking the work order complete.";

export interface CompletionContact {
  _id: string;
  name: string;
  phone: string;
  email: string;
  phoneValid: boolean;
  emailValid: boolean;
  isPrimary: boolean;
}

export interface WorkOrderCompletionCheck {
  totalCents: number;
  blockedReason: string | null;
  invoiceOpen: boolean;
  contacts: CompletionContact[];
}

export type ChannelDelivery =
  | { status: "sent" }
  | { status: "failed"; error: string }
  | { status: "skipped" };

export interface WorkOrderCompletionResult {
  invoice: { _id: string; number: string; amountCents: number };
  payUrl?: string;
  delivery?: { sms: ChannelDelivery; email: ChannelDelivery };
}

export function isTenDigitUsPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length === 10;
}

export function completionBlockedReason(input: {
  completed: boolean;
  totalCents: number;
  hasCustomer: boolean;
  reachableContacts: number;
}): string | null {
  if (input.completed) return ALREADY_COMPLETE_REASON;
  if (input.totalCents <= 0) return ZERO_TOTAL_REASON;
  if (!input.hasCustomer) return NO_CUSTOMER_REASON;
  if (input.reachableContacts <= 0) return NO_CONTACT_REASON;
  return null;
}

type SendChannel =
  | { status: "skip" }
  | { status: "send"; toOverride?: string };

export interface CompletionSendPlan {
  contactId: string;
  sms: SendChannel;
  email: SendChannel;
}

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function phoneChannel(
  contact: CompletionContact,
  override: string | undefined,
): { ok: true; channel: SendChannel } | { ok: false; message: string } {
  if (override === undefined) {
    return {
      ok: true,
      channel: contact.phoneValid ? { status: "send" } : { status: "skip" },
    };
  }
  const trimmed = override.trim();
  if (!trimmed) return { ok: true, channel: { status: "skip" } };
  const unchanged = phoneDigits(trimmed) === phoneDigits(contact.phone);
  if (unchanged && contact.phoneValid) {
    return { ok: true, channel: { status: "send" } };
  }
  if (!isTenDigitUsPhone(trimmed)) {
    return { ok: false, message: "Enter a 10-digit phone number." };
  }
  return {
    ok: true,
    channel: {
      status: "send",
      ...(unchanged ? {} : { toOverride: trimmed }),
    },
  };
}

function emailChannel(
  contact: CompletionContact,
  override: string | undefined,
): { ok: true; channel: SendChannel } | { ok: false; message: string } {
  if (override === undefined) {
    return {
      ok: true,
      channel: contact.emailValid ? { status: "send" } : { status: "skip" },
    };
  }
  const trimmed = override.trim();
  if (!trimmed) return { ok: true, channel: { status: "skip" } };
  const unchanged = trimmed.toLowerCase() === contact.email.trim().toLowerCase();
  if (unchanged && contact.emailValid) {
    return { ok: true, channel: { status: "send" } };
  }
  if (!contactHasValidEmail(trimmed)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  return {
    ok: true,
    channel: {
      status: "send",
      ...(unchanged ? {} : { toOverride: trimmed }),
    },
  };
}

export function validateCompletionSend(input: {
  contacts: CompletionContact[];
  contactId: string;
  phoneOverride?: string;
  emailOverride?: string;
}): { ok: true; plan: CompletionSendPlan } | { ok: false; message: string } {
  const contact = input.contacts.find((row) => row._id === input.contactId);
  if (!contact || (!contact.phoneValid && !contact.emailValid)) {
    return { ok: false, message: "Choose a contact for this customer." };
  }
  const phone = phoneChannel(contact, input.phoneOverride);
  if (!phone.ok) return phone;
  const email = emailChannel(contact, input.emailOverride);
  if (!email.ok) return email;
  if (phone.channel.status === "skip" && email.channel.status === "skip") {
    return {
      ok: false,
      message: "Enter a valid phone number or email address.",
    };
  }
  return {
    ok: true,
    plan: {
      contactId: contact._id,
      sms: phone.channel,
      email: email.channel,
    },
  };
}

function contactName(first: string, last: string): string {
  const name = [first, last]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return name || "Contact";
}

export async function checkWorkOrderCompletion(
  workOrder: WorkOrderInvoiceSource & { completed?: boolean },
): Promise<WorkOrderCompletionCheck> {
  const totalCents = dollarsToCents(workOrder.total || 0);
  const customerRef = await resolveCustomerRefForWorkOrder(workOrder);
  const rows = customerRef
    ? await CustomerContact.find({
        customerRef,
        ...activeContactFilter,
      })
        .select("first last phone email isPrimary")
        .lean()
    : [];
  const contacts: CompletionContact[] = rows
    .map((row) => ({
      _id: String(row._id),
      name: contactName(row.first ?? "", row.last ?? ""),
      phone: row.phone ?? "",
      email: row.email ?? "",
      phoneValid: contactHasValidPhone(row.phone),
      emailValid: contactHasValidEmail(row.email),
      isPrimary: Boolean(row.isPrimary),
    }))
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  const reachableContacts = contacts.filter(
    (contact) => contact.phoneValid || contact.emailValid,
  ).length;
  const openInvoice = await findOpenInvoiceForWorkOrder(workOrder._id);
  return {
    totalCents,
    blockedReason: completionBlockedReason({
      completed: Boolean(workOrder.completed),
      totalCents,
      hasCustomer: Boolean(customerRef),
      reachableContacts,
    }),
    invoiceOpen: Boolean(openInvoice),
    contacts,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function dueSentence(due: Date | null | undefined): string {
  if (!(due instanceof Date) || Number.isNaN(due.getTime())) return "";
  const label = due.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return ` Due ${label}.`;
}

async function invoiceMessageCopy(invoice: {
  number?: string;
  amountCents: number;
  dueDate?: Date | null;
}): Promise<{
  smsBody: string;
  emailSubject: string;
  emailBody: string;
  emailChrome?: EmailChrome | null;
}> {
  const number = invoice.number?.trim() || "invoice";
  const settings = await InvoiceMessageSettings.findOne({
    slug: INVOICE_MESSAGE_SETTINGS_SLUG,
  }).lean();
  const [smsTemplate, emailTemplate] = await Promise.all([
    settings?.smsTemplateRef
      ? MessageTemplate.findOne({
          _id: settings.smsTemplateRef,
          templateType: "sms",
          deletedAt: null,
        }).lean()
      : null,
    settings?.emailTemplateRef
      ? MessageTemplate.findOne({
          _id: settings.emailTemplateRef,
          templateType: "email",
          deletedAt: null,
        }).lean()
      : null,
  ]);
  const smsBody =
    smsTemplate?.body?.trim() ||
    `Hi {{first_name}}, invoice ${number} is ready. Total due: ${formatUsd(invoice.amountCents)}.${dueSentence(invoice.dueDate)}`;
  const emailSubject = emailTemplate?.subject?.trim() || `Invoice ${number}`;
  const emailBody =
    emailTemplate?.body?.trim() ||
    [
      "<p>Hi {{first_name}},</p>",
      `<p>Please find invoice <strong>${escapeHtml(number)}</strong> below.</p>`,
      "<p>{{invoice}}</p>",
    ].join("");
  return {
    smsBody,
    emailSubject,
    emailBody,
    emailChrome: emailTemplate?.emailChrome ?? undefined,
  };
}

async function rollbackCompletion(workOrder: IWorkOrder): Promise<void> {
  workOrder.completed = false;
  await workOrder.save();
  try {
    await syncWorkOrderInvoice(workOrder);
  } catch (err) {
    console.error("work order completion rollback failed:", err);
  }
}

async function markCompletedAndInvoice(workOrder: IWorkOrder) {
  workOrder.completed = true;
  await workOrder.save();
  try {
    await syncWorkOrderInvoice(workOrder);
    const invoice = await findOpenInvoiceForWorkOrder(workOrder._id);
    if (!invoice) {
      throw new WorkOrderCompletionError(
        "This work order could not be invoiced. Check the total and customer, then try again.",
      );
    }
    return invoice;
  } catch (err) {
    await rollbackCompletion(workOrder);
    throw err;
  }
}

function deliveryFromResult(
  result: { results: Array<{ status: string; error?: string }> },
  fallback: string,
): ChannelDelivery {
  const item = result.results[0];
  if (item?.status === "sent") return { status: "sent" };
  return { status: "failed", error: item?.error || fallback };
}

async function sendSms(input: {
  plan: CompletionSendPlan;
  invoiceId: string;
  amountCents: number;
  body: string;
  userId?: string | null;
  apiBase: string;
}): Promise<ChannelDelivery> {
  if (input.plan.sms.status !== "send") return { status: "skipped" };
  try {
    const account = await getTwilioAccountForSend();
    const lines = normalizePhoneLines(account.phoneNumbers);
    const from = (lines.find((line) => line.sms) ?? lines[0])?.phoneNumber;
    if (!from) {
      return { status: "failed", error: "No texting number is configured." };
    }
    const result = await dispatchMessagingBatch(
      {
        contactIds: [input.plan.contactId],
        body: input.body,
        mediaUrls: [],
        twilioAccountId: String(account._id),
        fromNumber: from,
        includePaymentLink: true,
        invoiceId: input.invoiceId,
        expectedAmountCents: input.amountCents,
        ...(input.plan.sms.toOverride
          ? { toOverride: input.plan.sms.toOverride }
          : {}),
      },
      { userId: input.userId ?? null, apiBase: input.apiBase },
    );
    return deliveryFromResult(result, "The text was not sent.");
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "The text was not sent.",
    };
  }
}

async function sendEmail(input: {
  plan: CompletionSendPlan;
  invoiceId: string;
  amountCents: number;
  subject: string;
  body: string;
  emailChrome?: EmailChrome | null;
  userId?: string | null;
}): Promise<ChannelDelivery> {
  if (input.plan.email.status !== "send") return { status: "skipped" };
  try {
    const account = await EmailAccount.findOne({ isActive: true }).sort({
      friendlyName: 1,
    });
    if (!account) {
      return { status: "failed", error: "No sending email account is configured." };
    }
    const result = await dispatchStaffEmailBatch({
      contactIds: [input.plan.contactId],
      subject: input.subject,
      body: input.body,
      emailChrome: input.emailChrome,
      emailAccountId: String(account._id),
      fromName: account.fromName,
      includePaymentLink: true,
      invoiceId: input.invoiceId,
      expectedAmountCents: input.amountCents,
      createdByUserId: input.userId ?? null,
      ...(input.plan.email.toOverride
        ? { toOverride: input.plan.email.toOverride }
        : {}),
    });
    return deliveryFromResult(result, "The email was not sent.");
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "The email was not sent.",
    };
  }
}

export async function completeWorkOrder(input: {
  workOrder: IWorkOrder;
  mode: "pay_now" | "send";
  contactId?: string;
  phoneOverride?: string;
  emailOverride?: string;
  userId?: string | null;
  apiBase: string;
}): Promise<WorkOrderCompletionResult> {
  const check = await checkWorkOrderCompletion(input.workOrder);
  if (check.blockedReason) {
    throw new WorkOrderCompletionError(check.blockedReason);
  }

  let plan: CompletionSendPlan | null = null;
  if (input.mode === "send") {
    const validated = validateCompletionSend({
      contacts: check.contacts,
      contactId: input.contactId ?? "",
      phoneOverride: input.phoneOverride,
      emailOverride: input.emailOverride,
    });
    if (!validated.ok) throw new WorkOrderCompletionError(validated.message);
    plan = validated.plan;
  }

  const invoice = await markCompletedAndInvoice(input.workOrder);
  const invoiceId = String(invoice._id);
  const summary = {
    _id: invoiceId,
    number: invoice.number,
    amountCents: invoice.amountCents,
  };

  if (input.mode === "pay_now") {
    try {
      if (!invoice.customerRef || !Types.ObjectId.isValid(String(invoice.customerRef))) {
        throw new WorkOrderCompletionError("Invoice has no customer");
      }
      const link = await createScopedPaymentLink(String(invoice.customerRef), {
        invoiceId,
        expectedAmountCents: invoice.amountCents,
      });
      if (!link?.payUrl) {
        throw new WorkOrderCompletionError("Could not create a payment link.");
      }
      return { invoice: summary, payUrl: link.payUrl };
    } catch (err) {
      await rollbackCompletion(input.workOrder);
      if (err instanceof CheckoutError) {
        throw new WorkOrderCompletionError(err.message, err.statusCode);
      }
      throw err;
    }
  }

  const copy = await invoiceMessageCopy(invoice);
  const [sms, email] = await Promise.all([
    sendSms({
      plan: plan!,
      invoiceId,
      amountCents: invoice.amountCents,
      body: copy.smsBody,
      userId: input.userId,
      apiBase: input.apiBase,
    }),
    sendEmail({
      plan: plan!,
      invoiceId,
      amountCents: invoice.amountCents,
      subject: copy.emailSubject,
      body: copy.emailBody,
      emailChrome: copy.emailChrome,
      userId: input.userId,
    }),
  ]);
  return { invoice: summary, delivery: { sms, email } };
}

export async function resendWorkOrderInvoice(input: {
  workOrder: IWorkOrder;
  contactId: string;
  phoneOverride?: string;
  emailOverride?: string;
  userId?: string | null;
  apiBase: string;
}): Promise<WorkOrderCompletionResult> {
  if (!input.workOrder.completed) {
    throw new WorkOrderCompletionError(
      "Mark this work order complete before resending its invoice.",
    );
  }
  const invoice = await findOpenInvoiceForWorkOrder(input.workOrder._id);
  if (!invoice) {
    throw new WorkOrderCompletionError(INVOICE_NOT_OPEN_REASON);
  }
  const check = await checkWorkOrderCompletion(input.workOrder);
  if (check.blockedReason && check.blockedReason !== ALREADY_COMPLETE_REASON) {
    throw new WorkOrderCompletionError(check.blockedReason);
  }
  const validated = validateCompletionSend({
    contacts: check.contacts,
    contactId: input.contactId,
    phoneOverride: input.phoneOverride,
    emailOverride: input.emailOverride,
  });
  if (!validated.ok) throw new WorkOrderCompletionError(validated.message);

  const copy = await invoiceMessageCopy(invoice);
  const [sms, email] = await Promise.all([
    sendSms({
      plan: validated.plan,
      invoiceId: String(invoice._id),
      amountCents: invoice.amountCents,
      body: copy.smsBody,
      userId: input.userId,
      apiBase: input.apiBase,
    }),
    sendEmail({
      plan: validated.plan,
      invoiceId: String(invoice._id),
      amountCents: invoice.amountCents,
      subject: copy.emailSubject,
      body: copy.emailBody,
      emailChrome: copy.emailChrome,
      userId: input.userId,
    }),
  ]);
  return {
    invoice: {
      _id: String(invoice._id),
      number: invoice.number,
      amountCents: invoice.amountCents,
    },
    delivery: { sms, email },
  };
}

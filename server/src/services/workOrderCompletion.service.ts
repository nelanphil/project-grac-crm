import { Types } from "mongoose";
import {
  Invoice,
  toPublicOfflinePayment,
  type IInvoice,
  type IOfflinePayment,
  type OfflinePaymentMethod,
  type PublicOfflinePayment,
} from "../models/mongo/Invoice";
import {
  emailInvoiceReceipt,
  type InvoiceEmailReceiptResult,
} from "./invoiceReceipt.service";
import {
  buildInvoiceViewUrl,
  ensureInvoiceViewToken,
} from "../utils/checkoutKey";
import { CustomerContact, activeContactFilter } from "../models/mongo/CustomerContact";
import { EmailAccount } from "../models/mongo/EmailAccount";
import type { IWorkOrder } from "../models/mongo/WorkOrder";
import { resolveAutomatedMessage } from "./automatedMessage.service";
import { CheckoutError } from "./checkout.service";
import { createScopedPaymentLink } from "./checkoutLink.service";
import { dispatchStaffEmailBatch } from "./emailMessage.service";
import {
  dollarsToCents,
  findOpenInvoiceForWorkOrder,
  markInvoicePaid,
  reopenInvoice,
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
  "This customer has no contact with a valid phone number or email. Add contact information before sending the invoice or taking a card payment.";

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
  /** Set when the customer cannot be texted or emailed. Cash and check can still complete. */
  sendBlockedReason: string | null;
  invoiceOpen: boolean;
  /** Staff-recorded check or cash payment that can be reopened. Card payments are omitted. */
  offlinePayment: PublicOfflinePayment | null;
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
  offlinePayment?: PublicOfflinePayment;
  /** True when a previous check or cash payment was reopened for this request. */
  reverted?: boolean;
  receipt?: {
    email: InvoiceEmailReceiptResult;
    phone: string;
    phoneValid: boolean;
    viewUrl: string;
  };
}

export function isTenDigitUsPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length === 10;
}

export function completionBlockedReason(input: {
  completed: boolean;
  totalCents: number;
  hasCustomer: boolean;
}): string | null {
  if (input.completed) return ALREADY_COMPLETE_REASON;
  if (input.totalCents <= 0) return ZERO_TOTAL_REASON;
  if (!input.hasCustomer) return NO_CUSTOMER_REASON;
  return null;
}

export function sendBlockedReason(reachableContacts: number): string | null {
  return reachableContacts <= 0 ? NO_CONTACT_REASON : null;
}

export type CompletedPaymentAction =
  | { action: "fresh" }
  | { action: "reuse_open" }
  | { action: "revert_offline" }
  | { action: "reject"; message: string };

/** Whether pay_now or paid_offline may reuse the open invoice on a completed order. */
export function settleCompletedBlockedReason(input: {
  completed: boolean;
  mode: "pay_now" | "send" | "paid_offline";
  blockedReason: string | null;
  invoiceOpen: boolean;
  offlinePaid?: boolean;
}): CompletedPaymentAction {
  if (!input.completed) {
    if (input.blockedReason) {
      return { action: "reject", message: input.blockedReason };
    }
    return { action: "fresh" };
  }
  if (input.mode === "send") {
    return {
      action: "reject",
      message: input.blockedReason ?? ALREADY_COMPLETE_REASON,
    };
  }
  if (input.blockedReason && input.blockedReason !== ALREADY_COMPLETE_REASON) {
    return { action: "reject", message: input.blockedReason };
  }
  if (!input.invoiceOpen) {
    if (
      input.offlinePaid &&
      (input.mode === "pay_now" || input.mode === "paid_offline")
    ) {
      return { action: "revert_offline" };
    }
    return { action: "reject", message: INVOICE_NOT_OPEN_REASON };
  }
  return { action: "reuse_open" };
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

type CompletionActor = {
  actorType?: "user" | "system";
  actorUserId?: string | null;
  actorName?: string | null;
};

/** Latest staff check/cash payment with no card charge. Null when a card already paid it. */
export async function findRevertibleOfflineInvoice(
  workOrderId: Types.ObjectId | string,
): Promise<IInvoice | null> {
  return Invoice.findOne({
    workOrderRef: workOrderId,
    status: "paid",
    "offlinePayment.method": { $in: ["check", "cash"] },
    providerPaymentId: { $in: [null, ""] },
  }).sort({ paidAt: -1 });
}

function offlinePaymentSnapshot(
  value: IOfflinePayment | null | undefined,
): IOfflinePayment | null {
  if (!value || (value.method !== "check" && value.method !== "cash")) return null;
  return {
    method: value.method,
    checkNumber: value.checkNumber ?? null,
    proofUrl: value.proofUrl ?? null,
    recordedByUserId: value.recordedByUserId ?? null,
    recordedByName: value.recordedByName ?? null,
    recordedAt: value.recordedAt ?? null,
  };
}

/** Reopen a check/cash invoice. `restore` puts that payment back if the new action fails. */
export async function revertOfflinePayment(
  workOrder: { _id: Types.ObjectId | string },
  actor?: CompletionActor,
): Promise<{ invoice: IInvoice; restore: () => Promise<void> } | null> {
  const invoice = await findRevertibleOfflineInvoice(workOrder._id);
  if (!invoice) return null;
  const snapshot = offlinePaymentSnapshot(invoice.offlinePayment);
  invoice.offlinePayment = null;
  invoice.markModified("offlinePayment");
  const reopened = await reopenInvoice({ invoice, actor });
  await Invoice.updateOne({ _id: reopened._id }, { $unset: { offlinePayment: "" } });
  reopened.offlinePayment = null;
  return {
    invoice: reopened,
    restore: async () => {
      const current = await Invoice.findById(reopened._id);
      if (!current || !snapshot) return;
      current.offlinePayment = snapshot;
      current.markModified("offlinePayment");
      await markInvoicePaid({ invoice: current, actor });
    },
  };
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
  const offlineInvoice = openInvoice
    ? null
    : await findRevertibleOfflineInvoice(workOrder._id);
  return {
    totalCents,
    blockedReason: completionBlockedReason({
      completed: Boolean(workOrder.completed),
      totalCents,
      hasCustomer: Boolean(customerRef),
    }),
    sendBlockedReason: sendBlockedReason(reachableContacts),
    invoiceOpen: Boolean(openInvoice),
    offlinePayment: toPublicOfflinePayment(offlineInvoice?.offlinePayment),
    contacts,
  };
}

async function invoiceMessageCopy(invoice: IInvoice): Promise<{
  smsBody: string;
  emailSubject: string;
  emailBody: string;
  emailChrome?: EmailChrome | null;
}> {
  const source = {
    number: invoice.number,
    amountCents: invoice.amountCents,
    dueDate: invoice.dueDate,
    record: invoice,
  };
  const [email, sms] = await Promise.all([
    resolveAutomatedMessage("workOrderCompleteEmail", source),
    resolveAutomatedMessage("workOrderCompleteSms", source),
  ]);
  return {
    smsBody: sms.body,
    emailSubject: email.subject,
    emailBody: email.body,
    emailChrome: email.emailChrome,
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
  mode: "pay_now" | "send" | "paid_offline";
  contactId?: string;
  phoneOverride?: string;
  emailOverride?: string;
  method?: OfflinePaymentMethod;
  checkNumber?: string;
  proofUrl?: string;
  userId?: string | null;
  actorName?: string | null;
  actor?: CompletionActor;
  apiBase: string;
}): Promise<WorkOrderCompletionResult> {
  const check = await checkWorkOrderCompletion(input.workOrder);
  const alreadyComplete = Boolean(input.workOrder.completed);
  const decision = settleCompletedBlockedReason({
    completed: alreadyComplete,
    mode: input.mode,
    blockedReason: check.blockedReason,
    invoiceOpen: check.invoiceOpen,
    offlinePaid: Boolean(check.offlinePayment),
  });
  if (decision.action === "reject") {
    throw new WorkOrderCompletionError(decision.message);
  }
  if (input.mode !== "paid_offline" && check.sendBlockedReason) {
    throw new WorkOrderCompletionError(check.sendBlockedReason);
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

  const actor = input.actor ?? {
    actorType: input.userId ? "user" : "system",
    actorUserId: input.userId ?? null,
    actorName: input.actorName ?? null,
  };
  let restore: (() => Promise<void>) | null = null;
  let reverted = false;
  let invoice: IInvoice | null = null;
  if (decision.action === "reuse_open") {
    invoice = await findOpenInvoiceForWorkOrder(input.workOrder._id);
  } else if (decision.action === "revert_offline") {
    const revertedPayment = await revertOfflinePayment(input.workOrder, actor);
    if (revertedPayment) {
      restore = revertedPayment.restore;
      reverted = true;
      invoice = revertedPayment.invoice;
    }
  } else {
    invoice = await markCompletedAndInvoice(input.workOrder);
  }
  if (!invoice) {
    throw new WorkOrderCompletionError(INVOICE_NOT_OPEN_REASON);
  }
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
      return withReverted({ invoice: summary, payUrl: link.payUrl }, reverted);
    } catch (err) {
      if (restore) await restore();
      else if (!alreadyComplete) await rollbackCompletion(input.workOrder);
      if (err instanceof CheckoutError) {
        throw new WorkOrderCompletionError(err.message, err.statusCode);
      }
      throw err;
    }
  }

  if (input.mode === "paid_offline") {
    let recorded = false;
    try {
      if (input.method !== "check" && input.method !== "cash") {
        throw new WorkOrderCompletionError("Choose check or cash.");
      }
      const proofUrl = input.proofUrl?.trim() || "";
      if (proofUrl && !proofUrl.startsWith("https://")) {
        throw new WorkOrderCompletionError("Proof URL must start with https://");
      }
      const userId =
        input.userId && Types.ObjectId.isValid(input.userId)
          ? new Types.ObjectId(input.userId)
          : null;
      invoice.offlinePayment = {
        method: input.method,
        checkNumber:
          input.method === "check" ? input.checkNumber?.trim() || null : null,
        proofUrl: proofUrl || null,
        recordedByUserId: userId,
        recordedByName: input.actorName?.trim() || null,
        recordedAt: new Date(),
      };
      invoice.markModified("offlinePayment");
      const paid = await markInvoicePaid({
        invoice,
        actor: {
          actorType: input.userId ? "user" : "system",
          actorUserId: input.userId ?? null,
          actorName: input.actorName ?? null,
        },
      });
      recorded = true;
      const offlinePayment = toPublicOfflinePayment(paid.offlinePayment);
      if (!offlinePayment) {
        throw new WorkOrderCompletionError("Could not record this payment.");
      }
      const primary =
        check.contacts.find((contact) => contact.isPrimary) ??
        check.contacts[0] ??
        null;
      let email: InvoiceEmailReceiptResult = {
        status: "failed",
        error: "The email was not sent.",
      };
      try {
        email = await emailInvoiceReceipt({ invoice: paid });
      } catch (err) {
        console.error("paid invoice email failed:", err);
        email = {
          status: "failed",
          error: err instanceof Error ? err.message : "The email was not sent.",
        };
      }
      let viewUrl = "";
      try {
        viewUrl = buildInvoiceViewUrl(await ensureInvoiceViewToken(paid));
      } catch (err) {
        console.error("invoice view link failed:", err);
      }
      return withReverted(
        {
          invoice: summary,
          offlinePayment,
          receipt: {
            email,
            phone: primary?.phone ?? "",
            phoneValid: Boolean(primary?.phoneValid),
            viewUrl,
          },
        },
        reverted,
      );
    } catch (err) {
      if (!recorded) {
        if (restore) await restore();
        else if (!alreadyComplete) await rollbackCompletion(input.workOrder);
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
  return withReverted({ invoice: summary, delivery: { sms, email } }, reverted);
}

function withReverted<T extends WorkOrderCompletionResult>(
  result: T,
  reverted: boolean,
): T {
  return reverted ? { ...result, reverted: true } : result;
}

export async function resendWorkOrderInvoice(input: {
  workOrder: IWorkOrder;
  contactId: string;
  phoneOverride?: string;
  emailOverride?: string;
  userId?: string | null;
  actor?: CompletionActor;
  apiBase: string;
}): Promise<WorkOrderCompletionResult> {
  if (!input.workOrder.completed) {
    throw new WorkOrderCompletionError(
      "Mark this work order complete before resending its invoice.",
    );
  }
  let invoice = await findOpenInvoiceForWorkOrder(input.workOrder._id);
  let restore: (() => Promise<void>) | null = null;
  let reverted = false;
  if (!invoice) {
    const revertedPayment = await revertOfflinePayment(input.workOrder, input.actor);
    if (!revertedPayment) {
      throw new WorkOrderCompletionError(INVOICE_NOT_OPEN_REASON);
    }
    invoice = revertedPayment.invoice;
    restore = revertedPayment.restore;
    reverted = true;
  }
  try {
    const check = await checkWorkOrderCompletion(input.workOrder);
    if (check.blockedReason && check.blockedReason !== ALREADY_COMPLETE_REASON) {
      throw new WorkOrderCompletionError(check.blockedReason);
    }
    if (check.sendBlockedReason) {
      throw new WorkOrderCompletionError(check.sendBlockedReason);
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
    if (restore && sms.status !== "sent" && email.status !== "sent") {
      const putBack = restore;
      restore = null;
      await putBack();
      const detail =
        sms.status === "failed"
          ? sms.error
          : email.status === "failed"
            ? email.error
            : "The invoice was not sent.";
      throw new WorkOrderCompletionError(detail);
    }
    return withReverted(
      {
        invoice: {
          _id: String(invoice._id),
          number: invoice.number,
          amountCents: invoice.amountCents,
        },
        delivery: { sms, email },
      },
      reverted,
    );
  } catch (err) {
    if (restore) await restore();
    throw err;
  }
}

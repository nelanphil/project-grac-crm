import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { EmailAccount } from "../models/mongo/EmailAccount";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import {
  ScheduledEmailSend,
  ScheduledEmailStatus,
} from "../models/mongo/ScheduledEmailSend";
import {
  emailMessagePreviewSchema,
  emailMessageRescheduleSchema,
  emailMessageScheduleSchema,
  emailMessageSendSchema,
  emailPaymentLinkAvailabilitySchema,
  SCHEDULED_EMAIL_STATUS_FILTERS,
} from "../schemas/emailMessage.schema";
import {
  dispatchStaffEmailBatch,
  loadActiveEmailAccount,
  resolveEmailContent,
  StaffEmailBatchError,
} from "../services/emailMessage.service";
import {
  DEFAULT_EMAIL_CHROME,
  mergeEmailChrome,
  renderEmailChrome,
} from "../utils/emailChrome";
import { buildStaffOutboundEmail } from "../utils/emailTemplates";
import { buildUnsubscribeUrl } from "../utils/unsubscribeToken";
import {
  renderMessageTemplate,
  templateUsesPaymentLink,
} from "../utils/messageTemplate";
import {
  buildTemplateContextForContact,
  sampleTemplateContext,
} from "../utils/messagingContext";
import { samplePayUrl } from "../utils/payToken";
import {
  customerHasPayableInvoice,
  payableInvoiceCustomerIds,
} from "../utils/paymentLinkForCustomer";
import {
  parseHubContactPaging,
  parseRenewalScope,
  searchHubContacts,
} from "../utils/messagingContacts";
import {
  parseFutureScheduledAt,
  ScheduledAtError,
} from "../utils/scheduledEmail";

const PAGE_SIZES = new Set([25, 50, 100, 150, 200, 250]);
const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

function toPublicEmailAccount(account: {
  _id: unknown;
  friendlyName: string;
  fromName: string;
  fromEmail: string;
  isActive: boolean;
}) {
  return {
    _id: String(account._id),
    friendlyName: account.friendlyName,
    fromName: account.fromName,
    fromEmail: account.fromEmail,
    isActive: account.isActive,
  };
}

async function accountNameMap(
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => OBJECT_ID_HEX.test(id)))];
  if (unique.length === 0) return new Map();
  const rows = await EmailAccount.find({ _id: { $in: unique } })
    .select("friendlyName")
    .lean();
  return new Map(rows.map((r) => [String(r._id), r.friendlyName]));
}

function toPublicEmailCommunication(
  doc: Record<string, unknown>,
  accountFriendlyName?: string,
) {
  return {
    _id: String(doc._id),
    emailAccountRef: doc.emailAccountRef ? String(doc.emailAccountRef) : null,
    accountFriendlyName: accountFriendlyName ?? null,
    fromName: doc.fromName ?? "",
    fromEmail: doc.fromEmail ?? "",
    toEmail: doc.toEmail ?? "",
    subject: doc.subject ?? "",
    body: doc.body ?? "",
    html: doc.html ?? "",
    status: doc.status,
    providerMessageId: doc.providerMessageId ?? null,
    errorMessage: doc.errorMessage ?? null,
    customerRef: doc.customerRef ? String(doc.customerRef) : null,
    contactRef: doc.contactRef ? String(doc.contactRef) : null,
    templateRef: doc.templateRef ? String(doc.templateRef) : null,
    createdByUserRef: doc.createdByUserRef
      ? String(doc.createdByUserRef)
      : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPublicScheduledEmail(
  doc: object,
  accountFriendlyName?: string,
) {
  const record = doc as Record<string, unknown>;
  const contactIds = Array.isArray(record.contactIds)
    ? (record.contactIds as unknown[]).map(String)
    : [];
  return {
    _id: String(record._id),
    contactIds,
    recipientCount: contactIds.length,
    subject: record.subject ?? "",
    fromName: record.fromName ?? "",
    replyTo: record.replyTo ?? null,
    emailAccountRef: record.emailAccountRef
      ? String(record.emailAccountRef)
      : null,
    accountFriendlyName: accountFriendlyName ?? null,
    emailsPerSecond: record.emailsPerSecond ?? 2,
    includePaymentLink: Boolean(record.includePaymentLink),
    scheduledAt: record.scheduledAt,
    status: record.status,
    summary: record.summary ?? null,
    errorMessage: record.errorMessage ?? null,
    cancelledAt: record.cancelledAt ?? null,
    createdByUserRef: record.createdByUserRef
      ? String(record.createdByUserRef)
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function staffEmailErrorResponse(err: unknown, res: Response): boolean {
  if (err instanceof StaffEmailBatchError || err instanceof ScheduledAtError) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  return false;
}

// GET /email-messages/accounts
export async function listEmailSendAccounts(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const accounts = await EmailAccount.find({ isActive: true })
      .sort({ friendlyName: 1 })
      .select("friendlyName fromName fromEmail isActive")
      .lean();
    res.json({ accounts: accounts.map(toPublicEmailAccount) });
  } catch (err) {
    console.error("GET /email-messages/accounts error:", err);
    res.status(500).json({ message: "Failed to load email accounts" });
  }
}

// GET /email-messages/contacts
export async function searchEmailContacts(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const { page, pageSize } = parseHubContactPaging(req.query);
    const renewal = parseRenewalScope(req.query.year, req.query.month);
    if (renewal.error) {
      res.status(400).json({ message: renewal.error });
      return;
    }

    const result = await searchHubContacts({
      channel: "email",
      search: String(req.query.search ?? ""),
      scope: renewal.scope,
      page,
      pageSize,
    });
    res.json(result);
  } catch (err) {
    console.error("GET /email-messages/contacts error:", err);
    res.status(500).json({ message: "Failed to search email contacts" });
  }
}

// POST /email-messages/payment-link-availability
export async function paymentLinkAvailability(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = emailPaymentLinkAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const available = await payableInvoiceCustomerIds(parsed.data.customerIds);
    res.json({
      available: parsed.data.customerIds.map((customerId) => ({
        customerId,
        hasPayableInvoice: available.has(customerId),
      })),
    });
  } catch (err) {
    console.error("POST /email-messages/payment-link-availability error:", err);
    res.status(500).json({
      message: "Failed to check payment link availability",
    });
  }
}

// POST /email-messages/preview
export async function previewEmailMessage(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = emailMessagePreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { subject, body, contactId, renewalYear, renewalMonth } = parsed.data;
    const chrome = mergeEmailChrome(
      parsed.data.emailChrome ?? DEFAULT_EMAIL_CHROME,
    );
    const scope =
      renewalYear !== undefined && renewalMonth !== undefined
        ? { year: renewalYear, month: renewalMonth }
        : undefined;

    let context = sampleTemplateContext();
    let sample = true;
    let customerRef: string | null = null;
    if (contactId) {
      const built = await buildTemplateContextForContact(contactId, scope);
      if (!built) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      context = built.context;
      sample = false;
      customerRef = built.contact.customerRef;
    }

    const wantsPayLink =
      parsed.data.includePaymentLink === true ||
      templateUsesPaymentLink(
        subject,
        body,
        chrome.headerHtml,
        chrome.footerHtml,
      );
    let paymentUrl: string | undefined;
    if (wantsPayLink) {
      const showButton = sample
        ? true
        : customerRef
          ? await customerHasPayableInvoice(customerRef, scope)
          : false;
      if (showButton) {
        paymentUrl = samplePayUrl();
        context = { ...context, payment_link: paymentUrl };
      }
    }

    const renderedSubject = renderMessageTemplate(subject, context);
    const renderedBody = renderMessageTemplate(body, context);
    const renderedChrome = renderEmailChrome(chrome, (value) =>
      renderMessageTemplate(value, context),
    );
    const previewEmail = (context.email || "jordan.lee@example.com").trim();
    const wrapped = buildStaffOutboundEmail({
      subject: renderedSubject,
      bodyText: renderedBody,
      paymentUrl,
      chrome: renderedChrome,
      unsubscribeUrl: buildUnsubscribeUrl(previewEmail, "general"),
    });

    res.json({
      renderedSubject: wrapped.subject,
      renderedBody,
      html: wrapped.html,
      context,
      sample,
    });
  } catch (err) {
    console.error("POST /email-messages/preview error:", err);
    res.status(500).json({ message: "Failed to preview email" });
  }
}

// POST /email-messages/send
export async function sendEmailMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = emailMessageSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const content = await resolveEmailContent(data);
    const result = await dispatchStaffEmailBatch({
      contactIds: data.contactIds,
      subject: content.subject,
      body: content.body,
      emailChrome: content.chrome,
      templateId: content.templateRef ? String(content.templateRef) : null,
      emailAccountId: data.emailAccountId,
      fromName: data.fromName,
      replyTo: data.replyTo,
      emailsPerSecond: data.emailsPerSecond,
      renewalYear: data.renewalYear,
      renewalMonth: data.renewalMonth,
      includePaymentLink: data.includePaymentLink,
      createdByUserId: req.user?.id ?? null,
    });
    res.json(result);
  } catch (err) {
    if (staffEmailErrorResponse(err, res)) return;
    console.error("POST /email-messages/send error:", err);
    res.status(500).json({ message: "Failed to send emails" });
  }
}

// POST /email-messages/schedule
export async function scheduleEmailMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = emailMessageScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const scheduledAt = parseFutureScheduledAt(data.scheduledAt);
    const content = await resolveEmailContent(data);
    const account = await loadActiveEmailAccount(data.emailAccountId);
    const uniqueContactIds = [...new Set(data.contactIds)];
    const userId = req.user?.id
      ? new Types.ObjectId(req.user.id)
      : null;

    const row = await ScheduledEmailSend.create({
      contactIds: uniqueContactIds,
      subject: content.subject,
      body: content.body,
      emailChrome: content.chrome,
      templateRef: content.templateRef,
      emailAccountRef: account._id,
      fromName: data.fromName?.trim() || account.fromName,
      replyTo: data.replyTo ?? null,
      emailsPerSecond: data.emailsPerSecond ?? 2,
      renewalYear: data.renewalYear ?? null,
      renewalMonth: data.renewalMonth ?? null,
      includePaymentLink: data.includePaymentLink === true,
      scheduledAt,
      status: "scheduled",
      createdByUserRef: userId,
    });

    res.status(201).json({
      scheduled: toPublicScheduledEmail(
        row.toObject(),
        account.friendlyName,
      ),
    });
  } catch (err) {
    if (staffEmailErrorResponse(err, res)) return;
    console.error("POST /email-messages/schedule error:", err);
    res.status(500).json({ message: "Failed to schedule emails" });
  }
}

// GET /email-messages/scheduled
export async function listScheduledEmailMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10) || 25;
    const pageSize = PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 25;

    const statusRaw = String(req.query.status ?? "scheduled");
    const filter: Record<string, unknown> = {};
    if (statusRaw !== "all") {
      if (
        !SCHEDULED_EMAIL_STATUS_FILTERS.includes(
          statusRaw as (typeof SCHEDULED_EMAIL_STATUS_FILTERS)[number],
        )
      ) {
        res.status(400).json({ message: "Invalid status filter" });
        return;
      }
      filter.status = statusRaw as ScheduledEmailStatus;
    }

    const [total, rows] = await Promise.all([
      ScheduledEmailSend.countDocuments(filter),
      ScheduledEmailSend.find(filter)
        .sort({ scheduledAt: 1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const names = await accountNameMap(
      rows.map((r) => String(r.emailAccountRef)),
    );

    res.json({
      scheduled: rows.map((r) =>
        toPublicScheduledEmail(r, names.get(String(r.emailAccountRef))),
      ),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /email-messages/scheduled error:", err);
    res.status(500).json({ message: "Failed to list scheduled emails" });
  }
}

// PATCH /email-messages/scheduled/:id
export async function rescheduleEmailMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid scheduled email id" });
      return;
    }
    const parsed = emailMessageRescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const scheduledAt = parseFutureScheduledAt(parsed.data.scheduledAt);
    const row = await ScheduledEmailSend.findById(req.params.id);
    if (!row) {
      res.status(404).json({ message: "Scheduled email not found" });
      return;
    }
    if (row.status !== "scheduled") {
      res.status(400).json({
        message: "Only upcoming scheduled emails can be rescheduled",
      });
      return;
    }

    row.scheduledAt = scheduledAt;
    await row.save();

    const names = await accountNameMap([String(row.emailAccountRef)]);
    res.json({
      scheduled: toPublicScheduledEmail(
        row.toObject(),
        names.get(String(row.emailAccountRef)),
      ),
    });
  } catch (err) {
    if (staffEmailErrorResponse(err, res)) return;
    console.error("PATCH /email-messages/scheduled/:id error:", err);
    res.status(500).json({ message: "Failed to reschedule email" });
  }
}

// POST /email-messages/scheduled/:id/cancel
export async function cancelScheduledEmailMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid scheduled email id" });
      return;
    }

    const row = await ScheduledEmailSend.findById(req.params.id);
    if (!row) {
      res.status(404).json({ message: "Scheduled email not found" });
      return;
    }
    if (row.status !== "scheduled") {
      res.status(400).json({
        message: "Only upcoming scheduled emails can be cancelled",
      });
      return;
    }

    row.status = "cancelled";
    row.cancelledAt = new Date();
    await row.save();

    const names = await accountNameMap([String(row.emailAccountRef)]);
    res.json({
      scheduled: toPublicScheduledEmail(
        row.toObject(),
        names.get(String(row.emailAccountRef)),
      ),
    });
  } catch (err) {
    console.error("POST /email-messages/scheduled/:id/cancel error:", err);
    res.status(500).json({ message: "Failed to cancel scheduled email" });
  }
}

// GET /email-messages
export async function listEmailMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "50"), 10) || 50;
    const pageSize = PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 50;

    const filter: Record<string, unknown> = {};

    if (
      req.query.customerId &&
      Types.ObjectId.isValid(String(req.query.customerId))
    ) {
      filter.customerRef = String(req.query.customerId);
    }
    if (
      req.query.contactId &&
      Types.ObjectId.isValid(String(req.query.contactId))
    ) {
      filter.contactRef = String(req.query.contactId);
    }
    if (
      req.query.emailAccountId &&
      Types.ObjectId.isValid(String(req.query.emailAccountId))
    ) {
      filter.emailAccountRef = String(req.query.emailAccountId);
    }
    if (req.query.status === "sent" || req.query.status === "failed") {
      filter.status = req.query.status;
    }

    const [total, rows] = await Promise.all([
      EmailCommunication.countDocuments(filter),
      EmailCommunication.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const names = await accountNameMap(
      rows.map((r) => String(r.emailAccountRef)),
    );

    res.json({
      emails: rows.map((r) =>
        toPublicEmailCommunication(
          r,
          names.get(String(r.emailAccountRef)),
        ),
      ),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /email-messages error:", err);
    res.status(500).json({ message: "Failed to list sent emails" });
  }
}

// GET /email-messages/:id
export async function getEmailMessage(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid email id" });
      return;
    }
    const row = await EmailCommunication.findById(req.params.id).lean();
    if (!row) {
      res.status(404).json({ message: "Email not found" });
      return;
    }
    const names = await accountNameMap([String(row.emailAccountRef)]);
    res.json({
      email: toPublicEmailCommunication(
        row,
        names.get(String(row.emailAccountRef)),
      ),
    });
  } catch (err) {
    console.error("GET /email-messages/:id error:", err);
    res.status(500).json({ message: "Failed to load email" });
  }
}

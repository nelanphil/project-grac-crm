import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { EmailAccount } from "../models/mongo/EmailAccount";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import {
  emailMessagePreviewSchema,
  emailMessageSendSchema,
  emailPaymentLinkAvailabilitySchema,
} from "../schemas/emailMessage.schema";
import { sendWithEmailAccount } from "../services/email.service";
import {
  DEFAULT_EMAIL_CHROME,
  EmailChrome,
  mergeEmailChrome,
  renderEmailChrome,
} from "../utils/emailChrome";
import { buildStaffOutboundEmail } from "../utils/emailTemplates";
import {
  renderMessageTemplate,
  templateUsesPaymentLink,
} from "../utils/messageTemplate";
import {
  buildTemplateContextForContact,
  contactHasValidEmail,
  sampleTemplateContext,
} from "../utils/messagingContext";
import { samplePayUrl } from "../utils/payToken";
import {
  createPaymentLinkCache,
  customerHasPayableInvoice,
  payableInvoiceCustomerIds,
} from "../utils/paymentLinkForCustomer";
import {
  parseHubContactPaging,
  parseRenewalScope,
  searchHubContacts,
} from "../utils/messagingContacts";

const PAGE_SIZES = new Set([25, 50, 100, 150, 200, 250]);
const SEND_CONCURRENCY = 5;
const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

function createStartPacer(perSecond: number): () => Promise<void> {
  const intervalMs = 1000 / Math.max(1, perSecond);
  let nextAllowed = 0;
  return async function pace() {
    const now = Date.now();
    const wait = Math.max(0, nextAllowed - now);
    nextAllowed = Math.max(now, nextAllowed) + intervalMs;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

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
    const wrapped = buildStaffOutboundEmail({
      subject: renderedSubject,
      bodyText: renderedBody,
      paymentUrl,
      chrome: renderedChrome,
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
    let subjectTemplate = data.subject?.trim() ?? "";
    let bodyTemplate = data.body?.trim() ?? "";
    let chrome: EmailChrome | undefined = data.emailChrome;

    if (data.templateId) {
      if (!Types.ObjectId.isValid(data.templateId)) {
        res.status(400).json({ message: "Invalid templateId" });
        return;
      }
      const template = await MessageTemplate.findById(data.templateId);
      if (!template || template.deletedAt) {
        res.status(404).json({ message: "Message template not found" });
        return;
      }
      if (template.templateType !== "email") {
        res.status(400).json({
          message: "Cannot send an SMS template as email",
        });
        return;
      }
      if (!subjectTemplate) subjectTemplate = template.subject ?? "";
      if (!bodyTemplate) bodyTemplate = template.body ?? "";
      if (!chrome) chrome = template.emailChrome ?? undefined;
    }

    if (!subjectTemplate.trim() || !bodyTemplate.trim()) {
      res.status(400).json({ message: "Email subject and body are required" });
      return;
    }

    const sendChrome = mergeEmailChrome(chrome ?? DEFAULT_EMAIL_CHROME);

    if (!Types.ObjectId.isValid(data.emailAccountId)) {
      res.status(400).json({ message: "Invalid emailAccountId" });
      return;
    }

    const account = await EmailAccount.findById(data.emailAccountId);
    if (!account || !account.isActive) {
      res.status(400).json({
        message: "Email account not found or inactive",
      });
      return;
    }

    const scope =
      data.renewalYear !== undefined && data.renewalMonth !== undefined
        ? { year: data.renewalYear, month: data.renewalMonth }
        : undefined;

    const uniqueContactIds = [...new Set(data.contactIds)];
    const templateRef = data.templateId
      ? new Types.ObjectId(data.templateId)
      : null;
    const userId = req.user?.id
      ? new Types.ObjectId(req.user.id)
      : null;
    const wantsPayLink =
      data.includePaymentLink === true ||
      templateUsesPaymentLink(
        subjectTemplate,
        bodyTemplate,
        sendChrome.headerHtml,
        sendChrome.footerHtml,
      );
    const paymentLinkForCustomer = wantsPayLink
      ? createPaymentLinkCache(scope)
      : null;

    const sendFromName = data.fromName?.trim() || account.fromName;
    const replyTo = data.replyTo;
    const emailsPerSecond = data.emailsPerSecond ?? 2;
    const paceStart = createStartPacer(emailsPerSecond);

    const results = await mapWithConcurrency(
      uniqueContactIds,
      Math.min(SEND_CONCURRENCY, emailsPerSecond),
      async (contactId) => {
        await paceStart();
        if (!Types.ObjectId.isValid(contactId)) {
          return {
            contactId,
            status: "failed" as const,
            error: "Invalid contact id",
          };
        }

        const built = await buildTemplateContextForContact(contactId, scope);
        if (!built) {
          return {
            contactId,
            status: "failed" as const,
            error: "Contact not found",
          };
        }

        const toEmail = (built.contact.email ?? "").trim().toLowerCase();
        if (!contactHasValidEmail(toEmail)) {
          return {
            contactId,
            status: "failed" as const,
            error: "Contact has no valid email",
          };
        }

        let context = built.context;
        let paymentUrl: string | undefined;
        if (wantsPayLink && paymentLinkForCustomer) {
          const minted = await paymentLinkForCustomer(
            built.contact.customerRef,
          );
          if (minted) {
            paymentUrl = minted.payUrl;
            context = { ...context, payment_link: paymentUrl };
          }
        }

        const renderedSubject = renderMessageTemplate(
          subjectTemplate,
          context,
        );
        const renderedBody = renderMessageTemplate(bodyTemplate, context);
        const renderedChrome = renderEmailChrome(sendChrome, (value) =>
          renderMessageTemplate(value, context),
        );
        const wrapped = buildStaffOutboundEmail({
          subject: renderedSubject,
          bodyText: renderedBody,
          paymentUrl,
          chrome: renderedChrome,
        });

        const contactRef = new Types.ObjectId(built.contact._id);
        const customerRef = built.customer
          ? new Types.ObjectId(built.customer._id)
          : null;

        try {
          const sent = await sendWithEmailAccount(account, {
            to: toEmail,
            subject: wrapped.subject,
            text: wrapped.text,
            html: wrapped.html,
            fromName: sendFromName,
            replyTo,
          });

          const row = await EmailCommunication.create({
            emailAccountRef: account._id,
            fromName: sendFromName,
            fromEmail: account.fromEmail,
            toEmail,
            subject: wrapped.subject,
            body: renderedBody,
            html: wrapped.html,
            status: "sent",
            providerMessageId: sent.messageId ?? null,
            errorMessage: null,
            customerRef,
            contactRef,
            templateRef,
            createdByUserRef: userId,
          });

          return {
            contactId,
            status: "sent" as const,
            emailId: String(row._id),
          };
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Failed to send email";

          const row = await EmailCommunication.create({
            emailAccountRef: account._id,
            fromName: sendFromName,
            fromEmail: account.fromEmail,
            toEmail,
            subject: wrapped.subject,
            body: renderedBody,
            html: wrapped.html,
            status: "failed",
            providerMessageId: null,
            errorMessage,
            customerRef,
            contactRef,
            templateRef,
            createdByUserRef: userId,
          });

          return {
            contactId,
            status: "failed" as const,
            emailId: String(row._id),
            error: errorMessage,
          };
        }
      },
    );

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.length - sent;

    res.json({
      results,
      summary: { total: results.length, sent, failed },
      fromName: sendFromName,
      fromEmail: account.fromEmail,
      emailAccountId: String(account._id),
    });
  } catch (err) {
    console.error("POST /email-messages/send error:", err);
    res.status(500).json({ message: "Failed to send emails" });
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

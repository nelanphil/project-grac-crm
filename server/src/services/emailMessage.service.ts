import { Types } from "mongoose";
import { EmailAccount, IEmailAccount } from "../models/mongo/EmailAccount";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import { sendWithEmailAccount } from "./email.service";
import {
  DEFAULT_EMAIL_CHROME,
  EmailChrome,
  mergeEmailChrome,
  renderEmailChrome,
} from "../utils/emailChrome";
import { buildStaffOutboundEmail } from "../utils/emailTemplates";
import { isEmailChannelEnabled } from "../utils/emailPreferences";
import {
  buildUnsubscribeUrl,
  listUnsubscribeHeaders,
} from "../utils/unsubscribeToken";
import {
  renderMessageTemplate,
  templateUsesPaymentLink,
} from "../utils/messageTemplate";
import {
  buildTemplateContextForContact,
  contactHasValidEmail,
} from "../utils/messagingContext";
import { createPaymentLinkCache } from "../utils/paymentLinkForCustomer";

const SEND_CONCURRENCY = 5;

export class StaffEmailBatchError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "StaffEmailBatchError";
    this.status = status;
  }
}

export type DispatchStaffEmailBatchInput = {
  contactIds: string[];
  subject: string;
  body: string;
  emailChrome?: EmailChrome | null;
  templateId?: string | null;
  emailAccountId: string;
  fromName?: string | null;
  replyTo?: string | null;
  emailsPerSecond?: number;
  renewalYear?: number | null;
  renewalMonth?: number | null;
  includePaymentLink?: boolean;
  createdByUserId?: string | null;
};

export type StaffEmailDispatchResultItem = {
  contactId: string;
  status: "sent" | "failed" | "skipped";
  emailId?: string;
  error?: string;
};

export type DispatchStaffEmailBatchResult = {
  results: StaffEmailDispatchResultItem[];
  summary: { total: number; sent: number; skipped: number; failed: number };
  fromName: string;
  fromEmail: string;
  emailAccountId: string;
};

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

export async function resolveEmailContent(data: {
  subject?: string;
  body?: string;
  emailChrome?: Partial<EmailChrome>;
  templateId?: string;
}): Promise<{
  subject: string;
  body: string;
  chrome: EmailChrome;
  templateRef: Types.ObjectId | null;
}> {
  let subjectTemplate = data.subject?.trim() ?? "";
  let bodyTemplate = data.body?.trim() ?? "";
  let chrome: EmailChrome | undefined = data.emailChrome
    ? mergeEmailChrome(data.emailChrome)
    : undefined;
  let templateRef: Types.ObjectId | null = null;

  if (data.templateId) {
    if (!Types.ObjectId.isValid(data.templateId)) {
      throw new StaffEmailBatchError("Invalid templateId", 400);
    }
    const template = await MessageTemplate.findById(data.templateId);
    if (!template || template.deletedAt) {
      throw new StaffEmailBatchError("Message template not found", 404);
    }
    if (template.templateType !== "email") {
      throw new StaffEmailBatchError(
        "Cannot send an SMS template as email",
        400,
      );
    }
    templateRef = template._id as Types.ObjectId;
    if (!subjectTemplate) subjectTemplate = template.subject ?? "";
    if (!bodyTemplate) bodyTemplate = template.body ?? "";
    if (!chrome) chrome = template.emailChrome ?? undefined;
  }

  if (!subjectTemplate.trim() || !bodyTemplate.trim()) {
    throw new StaffEmailBatchError(
      "Email subject and body are required",
      400,
    );
  }

  return {
    subject: subjectTemplate,
    body: bodyTemplate,
    chrome: mergeEmailChrome(chrome ?? DEFAULT_EMAIL_CHROME),
    templateRef,
  };
}

export async function loadActiveEmailAccount(
  emailAccountId: string,
): Promise<IEmailAccount> {
  if (!Types.ObjectId.isValid(emailAccountId)) {
    throw new StaffEmailBatchError("Invalid emailAccountId", 400);
  }
  const account = await EmailAccount.findById(emailAccountId);
  if (!account || !account.isActive) {
    throw new StaffEmailBatchError(
      "Email account not found or inactive",
      400,
    );
  }
  return account;
}

export async function dispatchStaffEmailBatch(
  input: DispatchStaffEmailBatchInput,
): Promise<DispatchStaffEmailBatchResult> {
  const account = await loadActiveEmailAccount(input.emailAccountId);
  const sendChrome = mergeEmailChrome(
    input.emailChrome ?? DEFAULT_EMAIL_CHROME,
  );
  const subjectTemplate = input.subject.trim();
  const bodyTemplate = input.body.trim();
  if (!subjectTemplate || !bodyTemplate) {
    throw new StaffEmailBatchError(
      "Email subject and body are required",
      400,
    );
  }

  const scope =
    input.renewalYear != null && input.renewalMonth != null
      ? { year: input.renewalYear, month: input.renewalMonth }
      : undefined;

  const uniqueContactIds = [...new Set(input.contactIds)];
  const templateRef = input.templateId
    ? Types.ObjectId.isValid(input.templateId)
      ? new Types.ObjectId(input.templateId)
      : null
    : null;
  const userId =
    input.createdByUserId && Types.ObjectId.isValid(input.createdByUserId)
      ? new Types.ObjectId(input.createdByUserId)
      : null;
  const wantsPayLink =
    input.includePaymentLink === true ||
    templateUsesPaymentLink(
      subjectTemplate,
      bodyTemplate,
      sendChrome.headerHtml,
      sendChrome.footerHtml,
    );
  const paymentLinkForCustomer = wantsPayLink
    ? createPaymentLinkCache(scope)
    : null;

  const sendFromName = input.fromName?.trim() || account.fromName;
  const replyTo = input.replyTo?.trim() || undefined;
  const emailsPerSecond = input.emailsPerSecond ?? 2;
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

      if (!(await isEmailChannelEnabled(toEmail, "general"))) {
        return {
          contactId,
          status: "skipped" as const,
          error: "Recipient unsubscribed from general notifications",
        };
      }

      let context = built.context;
      let paymentUrl: string | undefined;
      if (wantsPayLink && paymentLinkForCustomer) {
        const minted = await paymentLinkForCustomer(built.contact.customerRef);
        if (minted) {
          paymentUrl = minted.payUrl;
          context = { ...context, payment_link: paymentUrl };
        }
      }

      const renderedSubject = renderMessageTemplate(subjectTemplate, context);
      const renderedBody = renderMessageTemplate(bodyTemplate, context);
      const renderedChrome = renderEmailChrome(sendChrome, (value) =>
        renderMessageTemplate(value, context),
      );
      const unsubscribeUrl = buildUnsubscribeUrl(toEmail, "general");
      const wrapped = buildStaffOutboundEmail({
        subject: renderedSubject,
        bodyText: renderedBody,
        paymentUrl,
        chrome: renderedChrome,
        unsubscribeUrl,
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
          headers: listUnsubscribeHeaders(toEmail, "general"),
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
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.length - sent - skipped;

  return {
    results,
    summary: { total: results.length, sent, skipped, failed },
    fromName: sendFromName,
    fromEmail: account.fromEmail,
    emailAccountId: String(account._id),
  };
}

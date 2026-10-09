import { Response } from "express";
import { Readable } from "stream";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Customer } from "../models/mongo/Customer";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import { MessageThread } from "../models/mongo/MessageThread";
import { User } from "../models/mongo/User";
import {
  messagingCallSchema,
  messagingPreviewSchema,
  messagingRescheduleSchema,
  messagingScheduleSchema,
  messagingSendSchema,
  SCHEDULED_MESSAGE_STATUS_FILTERS,
  type MessagingSendInput,
} from "../schemas/messageTemplate.schema";
import {
  ScheduledMessageSend,
  type ScheduledMessageStatus,
} from "../models/mongo/ScheduledMessageSend";
import {
  parseFutureScheduledAt,
  ScheduledAtError,
} from "../utils/scheduledEmail";
import {
  MERGE_FIELDS,
  templateUsesPaymentLink,
} from "../utils/messageTemplate";
import {
  buildTemplateContextForContact,
  sampleTemplateContext,
  toE164,
} from "../utils/messagingContext";
import {
  parseHubContactPaging,
  parseRenewalScope,
  searchHubContacts,
} from "../utils/messagingContacts";
import {
  accountNameMap,
  toPublicCommunication,
} from "../utils/communicationFormat";
import { labelForNumber } from "../utils/twilioPhoneLines";
import {
  checkOpenThreadConflict,
  closeThread,
  resolveOrCreateOpenThreadForOutbound,
  sendIntoThread,
  ThreadConflictError,
  ThreadNotFoundError,
  touchThreadAfterMessage,
} from "../utils/messageThreads";
import {
  createOutboundCall,
  fetchTwilioRecordingMedia,
  getTwilioAccountForSend,
  getTwilioCredentialPair,
  getTwilioRuntimeEnvironment,
  resolveFromNumber,
  sendSms,
  TwilioServiceError,
} from "../services/twilio.service";
import { storedTwilioRecordingUrl } from "../utils/recordingPlayback";
import {
  isPubliclyReachableApiHost,
  resolvePublicApiBase,
} from "../utils/publicUrl";
import { sampleShortPaymentUrl } from "../utils/checkoutKey";
import {
  createShortPaymentLinkCache,
  customerHasPayableInvoice,
} from "../utils/paymentLinkForCustomer";
import { composeSmsPaymentBody } from "../utils/smsPaymentLink";
import { resolveSmsPaymentUrl } from "../services/smsPaymentLink.service";

const PAGE_SIZES = new Set([25, 50, 100, 150, 200, 250]);
const SEND_CONCURRENCY = 5;
const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

function objectIdStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .map((v) => (v == null ? "" : String(v)))
        .filter((id) => OBJECT_ID_HEX.test(id)),
    ),
  ];
}

const DEFAULT_SAY_TEXT =
  "Hello, this is a call from GRAC. Please call us back at your earliest convenience.";

/**
 * Twilio rejects StatusCallback URLs that aren't publicly resolvable (e.g.
 * `localhost`, `127.0.0.1`, bare hostnames without a dot) with a 21609
 * "not a valid URL" error. Only pass a statusCallback when we have a real
 * public base URL (e.g. PUBLIC_API_URL set to the deployed domain);
 * otherwise omit it so local/dev sends still succeed (delivery status just
 * won't be tracked back asynchronously).
 */
function buildStatusCallbackUrl(
  apiBase: string,
  accountSid: string,
): string | undefined {
  if (!isPubliclyReachableApiHost(apiBase)) return undefined;

  return `${apiBase}/webhooks/twilio/status?accountSid=${encodeURIComponent(accountSid)}`;
}

// GET /messaging/merge-fields
export async function getMergeFields(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  res.json({ fields: MERGE_FIELDS });
}

// GET /messaging/contacts?search=&year=&month=&page=&pageSize=
export async function searchMessagingContacts(
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
      channel: "sms",
      search: String(req.query.search ?? ""),
      scope: renewal.scope,
      page,
      pageSize,
    });
    res.json(result);
  } catch (err) {
    console.error("GET /messaging/contacts error:", err);
    res.status(500).json({ message: "Failed to search messaging contacts" });
  }
}

// POST /messaging/preview
export async function previewMessage(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = messagingPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const {
      body,
      contactId,
      renewalYear,
      renewalMonth,
      includePaymentLink,
      offerContractTemplateId,
    } = parsed.data;
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
      includePaymentLink === true || templateUsesPaymentLink(body);
    let paymentUrl: string | null = null;
    if (wantsPayLink) {
      const offerId = offerContractTemplateId ?? null;
      const showLink = sample
        ? true
        : customerRef
          ? (await customerHasPayableInvoice(customerRef)) || Boolean(offerId)
          : Boolean(offerId);
      if (showLink) paymentUrl = sampleShortPaymentUrl();
    }

    const composed = composeSmsPaymentBody({
      bodyTemplate: body,
      context,
      includePaymentLink: includePaymentLink === true,
      paymentUrl,
    });
    res.json({
      rendered: composed.body,
      context: { ...context, payment_link: paymentUrl ?? "" },
      sample,
    });
  } catch (err) {
    console.error("POST /messaging/preview error:", err);
    res.status(500).json({ message: "Failed to preview message" });
  }
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

export class MessagingDispatchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MessagingDispatchError";
    this.status = status;
  }
}

export async function dispatchMessagingBatch(
  data: MessagingSendInput,
  options: { userId?: string | null; apiBase: string },
) {
    let bodyTemplate = data.body?.trim() ?? "";
    let templateOfferId: string | null = null;

    if (data.templateId) {
      if (!Types.ObjectId.isValid(data.templateId)) {
        throw new MessagingDispatchError(400, "Invalid templateId");
      }
      const template = await MessageTemplate.findById(data.templateId);
      if (!template || template.deletedAt) {
        throw new MessagingDispatchError(404, "Message template not found");
      }
      if (template.templateType === "email") {
        throw new MessagingDispatchError(
          400,
          "Cannot send an email template as SMS",
        );
      }
      templateOfferId = template.offerContractTemplateId
        ? String(template.offerContractTemplateId)
        : null;
      if (!bodyTemplate) {
        bodyTemplate = template.body ?? "";
      }
    }

    const offerContractTemplateId =
      data.offerContractTemplateId !== undefined
        ? data.offerContractTemplateId
        : templateOfferId;

    if (!bodyTemplate.trim()) {
      throw new MessagingDispatchError(400, "Message body is empty");
    }

    let account;
    let fromNumber: string;
    try {
      account = await getTwilioAccountForSend(data.twilioAccountId);
      fromNumber = resolveFromNumber(account, data.fromNumber);
    } catch (err) {
      const message =
        err instanceof TwilioServiceError
          ? err.message
          : "Failed to resolve Twilio account";
      throw new MessagingDispatchError(400, message);
    }

    const scope =
      data.renewalYear !== undefined && data.renewalMonth !== undefined
        ? { year: data.renewalYear, month: data.renewalMonth }
        : undefined;

    const uniqueContactIds = [...new Set(data.contactIds)];
    const templateRef = data.templateId ?? null;
    const userId = options.userId ?? null;
    const mediaUrls = data.mediaUrls ?? [];
    const channel = mediaUrls.length > 0 ? ("mms" as const) : ("sms" as const);
    const apiBase = options.apiBase.replace(/\/$/, "");
    const statusCallbackUrl = buildStatusCallbackUrl(
      apiBase,
      account.accountSid,
    );
    const wantsPayLink =
      data.includePaymentLink === true ||
      templateUsesPaymentLink(bodyTemplate);
    const paymentLinkForCustomer = wantsPayLink
      ? createShortPaymentLinkCache(scope)
      : null;
    const offerInflight = new Map<string, Promise<unknown>>();

    const results = await mapWithConcurrency(
      uniqueContactIds,
      SEND_CONCURRENCY,
      async (contactId) => {
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

        const phoneOverride =
          uniqueContactIds.length === 1 ? data.toOverride?.trim() : "";
        const toPhone = phoneOverride || built.contact.phone;
        const toE164Number = toE164(toPhone);
        let paymentUrl: string | null = null;
        if (wantsPayLink && paymentLinkForCustomer) {
          paymentUrl = await resolveSmsPaymentUrl({
            contactId,
            customerId: built.contact.customerRef,
            offerContractTemplateId,
            offerContractOverrides: data.offerContractOverrides,
            paymentLinkForCustomer,
            offerInflight,
          });
        }
        const composed = composeSmsPaymentBody({
          bodyTemplate,
          context: built.context,
          includePaymentLink: data.includePaymentLink === true,
          paymentUrl,
        });
        if (composed.error) {
          return {
            contactId,
            status: "failed" as const,
            error: composed.error,
          };
        }
        const rendered = composed.body;
        const contactRef = new Types.ObjectId(built.contact._id);
        const customerRef = built.customer
          ? new Types.ObjectId(built.customer._id)
          : null;

        let thread;
        try {
          thread = data.threadId
            ? await sendIntoThread({
                threadId: data.threadId,
                userId: userId ?? null,
              })
            : await resolveOrCreateOpenThreadForOutbound({
                contactRef,
                customerRef,
                twilioAccountRef: account._id,
                accountSid: account.accountSid,
                ourNumber: fromNumber,
                userId: userId ?? null,
              });
        } catch (err) {
          const errorMessage =
            err instanceof ThreadNotFoundError ||
            err instanceof ThreadConflictError
              ? err.message
              : "Failed to resolve message thread";
          return {
            contactId,
            status: "failed" as const,
            error: errorMessage,
          };
        }

        if (data.threadId && String(thread.contactRef) !== contactId) {
          return {
            contactId,
            status: "failed" as const,
            error: "Thread does not belong to this contact",
          };
        }

        if (!toE164Number) {
          await TwilioCommunication.create({
            twilioAccountRef: account._id,
            accountSid: account.accountSid,
            channel,
            direction: "outbound",
            fromNumber,
            toNumber: toPhone || "",
            body: rendered,
            mediaUrls,
            customerRef,
            contactRef,
            threadRef: thread._id,
            templateRef,
            status: "failed",
            errorMessage: phoneOverride
              ? "Phone number is invalid"
              : "Contact phone number is invalid",
            createdByUserRef: userId ?? null,
          });
          await touchThreadAfterMessage(thread._id, {
            direction: "outbound",
            channel,
            body: rendered,
            at: new Date(),
          });
          return {
            contactId,
            status: "failed" as const,
            error: phoneOverride
              ? "Phone number is invalid"
              : "Contact phone number is invalid",
          };
        }

        try {
          const { sid } = await sendSms({
            account,
            from: fromNumber,
            to: toE164Number,
            body: rendered,
            mediaUrls,
            statusCallbackUrl,
          });

          await TwilioCommunication.create({
            twilioAccountRef: account._id,
            accountSid: account.accountSid,
            channel,
            direction: "outbound",
            fromNumber,
            toNumber: toE164Number,
            body: rendered,
            mediaUrls,
            customerRef,
            contactRef,
            threadRef: thread._id,
            templateRef,
            status: "sent",
            twilioSid: sid,
            createdByUserRef: userId ?? null,
          });
          await touchThreadAfterMessage(thread._id, {
            direction: "outbound",
            channel,
            body: rendered,
            at: new Date(),
          });

          return {
            contactId,
            status: "sent" as const,
            twilioSid: sid,
            threadId: String(thread._id),
          };
        } catch (err) {
          const errorMessage =
            err instanceof TwilioServiceError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Send failed";

          await TwilioCommunication.create({
            twilioAccountRef: account._id,
            accountSid: account.accountSid,
            channel,
            direction: "outbound",
            fromNumber,
            toNumber: toE164Number,
            body: rendered,
            mediaUrls,
            customerRef,
            contactRef,
            threadRef: thread._id,
            templateRef,
            status: "failed",
            errorMessage,
            createdByUserRef: userId ?? null,
          });
          await touchThreadAfterMessage(thread._id, {
            direction: "outbound",
            channel,
            body: rendered,
            at: new Date(),
          });

          return {
            contactId,
            status: "failed" as const,
            error: errorMessage,
            threadId: String(thread._id),
          };
        }
      },
    );

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return {
      results,
      summary: { total: results.length, sent, failed },
      fromNumber,
      twilioAccountId: String(account._id),
      accountSid: account.accountSid,
      channel,
    };
}

function messagingErrorResponse(err: unknown, res: Response): boolean {
  if (
    err instanceof MessagingDispatchError ||
    err instanceof ScheduledAtError
  ) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  return false;
}

function requestApiBase(req: AuthRequest): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`
  );
}

async function twilioAccountNameMap(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await TwilioAccount.find({ _id: { $in: unique } })
    .select("friendlyName")
    .lean();
  return new Map(rows.map((row) => [String(row._id), row.friendlyName]));
}

function toPublicScheduledMessage(
  doc: object,
  accountFriendlyName?: string,
) {
  const record = doc as Record<string, unknown>;
  const contactIds = Array.isArray(record.contactIds)
    ? (record.contactIds as unknown[]).map(String)
    : [];
  const mediaUrls = Array.isArray(record.mediaUrls)
    ? (record.mediaUrls as unknown[]).map(String)
    : [];
  return {
    _id: String(record._id),
    contactIds,
    recipientCount: contactIds.length,
    body: record.body ?? "",
    fromNumber: record.fromNumber ?? "",
    mediaUrls,
    twilioAccountRef: record.twilioAccountRef
      ? String(record.twilioAccountRef)
      : null,
    accountFriendlyName: accountFriendlyName ?? null,
    includePaymentLink: Boolean(record.includePaymentLink),
    offerContractTemplateId: record.offerContractTemplateId
      ? String(record.offerContractTemplateId)
      : null,
    offerContractOverrides: Array.isArray(record.offerContractOverrides)
      ? (
          record.offerContractOverrides as {
            contactId?: unknown;
            contractTemplateId?: unknown;
          }[]
        ).map((row) => ({
          contactId: String(row.contactId ?? ""),
          contractTemplateId: row.contractTemplateId
            ? String(row.contractTemplateId)
            : null,
        }))
      : [],
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

// POST /messaging/send
export async function sendMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = messagingSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await dispatchMessagingBatch(parsed.data, {
      userId: req.user?.id ?? null,
      apiBase: requestApiBase(req),
    });
    res.json(result);
  } catch (err) {
    if (messagingErrorResponse(err, res)) return;
    console.error("POST /messaging/send error:", err);
    res.status(500).json({ message: "Failed to send messages" });
  }
}

// POST /messaging/schedule
export async function scheduleMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = messagingScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const scheduledAt = parseFutureScheduledAt(data.scheduledAt);
    let bodyTemplate = data.body?.trim() ?? "";
    let templateOfferId: string | null = null;

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
      if (template.templateType === "email") {
        res.status(400).json({
          message: "Cannot send an email template as SMS",
        });
        return;
      }
      templateOfferId = template.offerContractTemplateId
        ? String(template.offerContractTemplateId)
        : null;
      if (!bodyTemplate) bodyTemplate = template.body ?? "";
    }

    if (!bodyTemplate.trim()) {
      res.status(400).json({ message: "Message body is empty" });
      return;
    }

    let account;
    let fromNumber: string;
    try {
      account = await getTwilioAccountForSend(data.twilioAccountId);
      fromNumber = resolveFromNumber(account, data.fromNumber);
    } catch (err) {
      const message =
        err instanceof TwilioServiceError
          ? err.message
          : "Failed to resolve Twilio account";
      res.status(400).json({ message });
      return;
    }

    const offerContractTemplateId =
      data.offerContractTemplateId !== undefined
        ? data.offerContractTemplateId
        : templateOfferId;
    const userId = req.user?.id ? new Types.ObjectId(req.user.id) : null;

    const row = await ScheduledMessageSend.create({
      contactIds: [...new Set(data.contactIds)],
      body: bodyTemplate,
      templateRef: data.templateId ? new Types.ObjectId(data.templateId) : null,
      twilioAccountRef: account._id,
      fromNumber,
      mediaUrls: data.mediaUrls ?? [],
      renewalYear: data.renewalYear ?? null,
      renewalMonth: data.renewalMonth ?? null,
      includePaymentLink: data.includePaymentLink === true,
      offerContractTemplateId: offerContractTemplateId
        ? new Types.ObjectId(offerContractTemplateId)
        : null,
      offerContractOverrides: (data.offerContractOverrides ?? []).map(
        (override) => ({
          contactId: override.contactId,
          contractTemplateId: override.contractTemplateId
            ? new Types.ObjectId(override.contractTemplateId)
            : null,
        }),
      ),
      scheduledAt,
      status: "scheduled",
      createdByUserRef: userId,
    });

    res.status(201).json({
      scheduled: toPublicScheduledMessage(
        row.toObject(),
        account.friendlyName,
      ),
    });
  } catch (err) {
    if (messagingErrorResponse(err, res)) return;
    console.error("POST /messaging/schedule error:", err);
    res.status(500).json({ message: "Failed to schedule messages" });
  }
}

// GET /messaging/scheduled
export async function listScheduledMessages(
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
        !SCHEDULED_MESSAGE_STATUS_FILTERS.includes(
          statusRaw as (typeof SCHEDULED_MESSAGE_STATUS_FILTERS)[number],
        )
      ) {
        res.status(400).json({ message: "Invalid status filter" });
        return;
      }
      filter.status = statusRaw as ScheduledMessageStatus;
    }

    const [total, rows] = await Promise.all([
      ScheduledMessageSend.countDocuments(filter),
      ScheduledMessageSend.find(filter)
        .sort({ scheduledAt: 1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const names = await twilioAccountNameMap(
      rows.map((row) => String(row.twilioAccountRef)),
    );

    res.json({
      scheduled: rows.map((row) =>
        toPublicScheduledMessage(
          row,
          names.get(String(row.twilioAccountRef)),
        ),
      ),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /messaging/scheduled error:", err);
    res.status(500).json({ message: "Failed to list scheduled messages" });
  }
}

// PATCH /messaging/scheduled/:id
export async function rescheduleMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid scheduled message id" });
      return;
    }
    const parsed = messagingRescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const scheduledAt = parseFutureScheduledAt(parsed.data.scheduledAt);
    const row = await ScheduledMessageSend.findById(req.params.id);
    if (!row) {
      res.status(404).json({ message: "Scheduled message not found" });
      return;
    }
    if (row.status !== "scheduled") {
      res.status(400).json({
        message: "Only upcoming scheduled messages can be rescheduled",
      });
      return;
    }

    row.scheduledAt = scheduledAt;
    await row.save();

    const names = await twilioAccountNameMap([String(row.twilioAccountRef)]);
    res.json({
      scheduled: toPublicScheduledMessage(
        row.toObject(),
        names.get(String(row.twilioAccountRef)),
      ),
    });
  } catch (err) {
    if (messagingErrorResponse(err, res)) return;
    console.error("PATCH /messaging/scheduled/:id error:", err);
    res.status(500).json({ message: "Failed to reschedule message" });
  }
}

// POST /messaging/scheduled/:id/cancel
export async function cancelScheduledMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid scheduled message id" });
      return;
    }

    const row = await ScheduledMessageSend.findById(req.params.id);
    if (!row) {
      res.status(404).json({ message: "Scheduled message not found" });
      return;
    }
    if (row.status !== "scheduled") {
      res.status(400).json({
        message: "Only upcoming scheduled messages can be cancelled",
      });
      return;
    }

    row.status = "cancelled";
    row.cancelledAt = new Date();
    await row.save();

    const names = await twilioAccountNameMap([String(row.twilioAccountRef)]);
    res.json({
      scheduled: toPublicScheduledMessage(
        row.toObject(),
        names.get(String(row.twilioAccountRef)),
      ),
    });
  } catch (err) {
    console.error("POST /messaging/scheduled/:id/cancel error:", err);
    res.status(500).json({ message: "Failed to cancel scheduled message" });
  }
}

// POST /messaging/calls
export async function placeCall(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = messagingCallSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const built = await buildTemplateContextForContact(data.contactId);
    if (!built) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    const toE164Number = toE164(built.contact.phone);
    if (!toE164Number) {
      res.status(400).json({ message: "Contact phone number is invalid" });
      return;
    }

    let account;
    let fromNumber: string;
    try {
      account = await getTwilioAccountForSend(data.twilioAccountId);
      fromNumber = resolveFromNumber(account, data.fromNumber);
    } catch (err) {
      const message =
        err instanceof TwilioServiceError
          ? err.message
          : "Failed to resolve Twilio account";
      res.status(400).json({ message });
      return;
    }

    const sayText = data.sayText?.trim() || DEFAULT_SAY_TEXT;
    const apiBase =
      process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    const statusCallbackUrl = buildStatusCallbackUrl(
      apiBase,
      account.accountSid,
    );

    const contactRef = new Types.ObjectId(built.contact._id);
    const customerRef = built.customer
      ? new Types.ObjectId(built.customer._id)
      : null;
    const userId = req.user?.id ?? null;
    const thread = await resolveOrCreateOpenThreadForOutbound({
      contactRef,
      customerRef,
      twilioAccountRef: account._id,
      accountSid: account.accountSid,
      ourNumber: fromNumber,
      userId,
    });

    try {
      const { sid } = await createOutboundCall({
        account,
        from: fromNumber,
        to: toE164Number,
        sayText,
        voice: account.sayVoice,
        statusCallbackUrl,
      });

      const doc = await TwilioCommunication.create({
        twilioAccountRef: account._id,
        accountSid: account.accountSid,
        channel: "voice",
        direction: "outbound",
        status: "queued",
        fromNumber,
        toNumber: toE164Number,
        body: sayText,
        mediaUrls: [],
        twilioSid: sid,
        customerRef,
        contactRef,
        threadRef: thread._id,
        createdByUserRef: userId,
      });
      await touchThreadAfterMessage(thread._id, {
        direction: "outbound",
        channel: "voice",
        body: sayText,
        at: new Date(),
      });

      res.status(201).json({
        communication: toPublicCommunication(doc, {
          friendlyName: account.friendlyName,
          accountSid: account.accountSid,
          phoneNumbers: account.phoneNumbers,
        }),
      });
    } catch (err) {
      const errorMessage =
        err instanceof TwilioServiceError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Call failed";

      await TwilioCommunication.create({
        twilioAccountRef: account._id,
        accountSid: account.accountSid,
        channel: "voice",
        direction: "outbound",
        status: "failed",
        fromNumber,
        toNumber: toE164Number,
        body: sayText,
        mediaUrls: [],
        customerRef,
        contactRef,
        threadRef: thread._id,
        errorMessage,
        createdByUserRef: userId,
      });
      await touchThreadAfterMessage(thread._id, {
        direction: "outbound",
        channel: "voice",
        body: sayText,
        at: new Date(),
      });

      res.status(400).json({ message: errorMessage });
    }
  } catch (err) {
    console.error("POST /messaging/calls error:", err);
    res.status(500).json({ message: "Failed to place call" });
  }
}

function parseAccountFilter(query: {
  twilioAccountId?: unknown;
  accountSid?: unknown;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const accountId = query.twilioAccountId
    ? String(query.twilioAccountId)
    : undefined;
  const accountSid = query.accountSid ? String(query.accountSid) : undefined;
  if (accountId && Types.ObjectId.isValid(accountId)) {
    filter.twilioAccountRef = accountId;
  }
  if (accountSid) {
    filter.accountSid = accountSid;
  }
  return filter;
}

// GET /messaging/communications
export async function listCommunications(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "50"), 10) || 50;
    const pageSize = PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 50;

    const filter: Record<string, unknown> = {
      ...parseAccountFilter(req.query),
    };

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
    if (req.query.channel) {
      const channel = String(req.query.channel);
      if (["sms", "mms", "voice"].includes(channel)) {
        filter.channel = channel;
      }
    }
    if (req.query.direction) {
      const direction = String(req.query.direction);
      if (["inbound", "outbound"].includes(direction)) {
        filter.direction = direction;
      }
    }
    if (req.query.unmatched === "1" || req.query.unmatched === "true") {
      filter.contactRef = null;
    }

    const [total, rows] = await Promise.all([
      TwilioCommunication.countDocuments(filter),
      TwilioCommunication.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const names = await accountNameMap(
      rows.map((r) => String(r.twilioAccountRef)),
    );

    res.json({
      communications: rows.map((r) =>
        toPublicCommunication(r, names.get(String(r.twilioAccountRef))),
      ),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /messaging/communications error:", err);
    res.status(500).json({ message: "Failed to list communications" });
  }
}

type ThreadLookups = {
  contactById: Map<string, Record<string, unknown>>;
  customerById: Map<string, Record<string, unknown>>;
  userById: Map<string, { _id: unknown; first_name?: string; last_name?: string }>;
  names: Map<
    string,
    { friendlyName: string; accountSid: string; phoneNumbers: unknown }
  >;
};

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return null;
}

function unreadTextQuery(): Record<string, unknown> {
  return {
    lastMessageDirection: "inbound",
    lastMessageChannel: { $in: ["sms", "mms"] },
    $or: [
      { readAt: null },
      { $expr: { $gt: ["$lastMessageAt", "$readAt"] } },
    ],
  };
}

async function buildThreadLookups(
  threads: Array<{
    contactRef?: Types.ObjectId | null;
    customerRef?: Types.ObjectId | null;
    twilioAccountRef: Types.ObjectId;
    readByUserRef?: Types.ObjectId | null;
  }>,
): Promise<ThreadLookups> {
  const contactIds = objectIdStrings(threads.map((t) => t.contactRef));
  const contacts = contactIds.length
    ? await CustomerContact.find({ _id: { $in: contactIds } })
        .select("_id first last phone customerRef label")
        .lean()
    : [];
  const contactById = new Map(contacts.map((c) => [String(c._id), c]));

  const customerIds = objectIdStrings([
    ...contacts.map((c) => c.customerRef),
    ...threads.map((t) => t.customerRef),
  ]);
  const customers = customerIds.length
    ? await Customer.find({ _id: { $in: customerIds } })
        .select("_id first last accountName")
        .lean()
    : [];
  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  const userIds = objectIdStrings(threads.map((t) => t.readByUserRef));
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select("_id first_name last_name")
        .lean()
    : [];
  const userById = new Map(users.map((user) => [String(user._id), user]));

  const names = await accountNameMap(
    threads.map((t) => String(t.twilioAccountRef)),
  );

  return { contactById, customerById, userById, names };
}

function publicRef(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function toPublicThread(
  thread: Record<string, unknown>,
  lookups: ThreadLookups,
) {
  const contact = thread.contactRef
    ? lookups.contactById.get(String(thread.contactRef))
    : undefined;
  const customer = thread.customerRef
    ? lookups.customerById.get(String(thread.customerRef))
    : contact
      ? lookups.customerById.get(String(contact.customerRef))
      : undefined;
  const accountLabels = lookups.names.get(String(thread.twilioAccountRef));
  const accountFriendlyName = accountLabels?.friendlyName ?? null;
  const ourNumber = String(thread.ourNumber ?? "");
  const reader = thread.readByUserRef
    ? lookups.userById.get(String(thread.readByUserRef))
    : undefined;

  return {
    _id: String(thread._id),
    contactRef: publicRef(thread.contactRef),
    customerRef: publicRef(thread.customerRef),
    twilioAccountRef: String(thread.twilioAccountRef),
    accountSid: thread.accountSid ?? "",
    accountFriendlyName,
    ourNumber,
    ourNumberLabel: labelForNumber(accountLabels?.phoneNumbers, ourNumber),
    contactPhoneSnapshot: thread.contactPhoneSnapshot ?? "",
    status: thread.status,
    startedByUserRef: thread.startedByUserRef
      ? String(thread.startedByUserRef)
      : null,
    closedAt:
      thread.closedAt instanceof Date
        ? thread.closedAt.toISOString()
        : ((thread.closedAt as string | null) ?? null),
    closedByUserRef: thread.closedByUserRef
      ? String(thread.closedByUserRef)
      : null,
    lastMessageAt:
      thread.lastMessageAt instanceof Date
        ? thread.lastMessageAt.toISOString()
        : ((thread.lastMessageAt as string | null) ?? null),
    lastMessageDirection: thread.lastMessageDirection ?? null,
    lastMessageChannel: thread.lastMessageChannel ?? null,
    lastMessagePreview: thread.lastMessagePreview ?? "",
    messageCount: thread.messageCount ?? 0,
    readAt: isoOrNull(thread.readAt),
    readBy: reader
      ? {
          _id: String(reader._id),
          first_name: reader.first_name ?? "",
          last_name: reader.last_name ?? "",
        }
      : null,
    contact: contact
      ? {
          _id: String(contact._id),
          first: contact.first ?? "",
          last: contact.last ?? "",
          phone: contact.phone ?? "",
          label: contact.label ?? "",
          customerRef: String(contact.customerRef),
        }
      : null,
    customer: customer
      ? {
          _id: String(customer._id),
          accountName: customer.accountName ?? "",
          first: customer.first ?? "",
          last: customer.last ?? "",
        }
      : null,
    createdAt:
      thread.createdAt instanceof Date
        ? thread.createdAt.toISOString()
        : String(thread.createdAt ?? ""),
    updatedAt:
      thread.updatedAt instanceof Date
        ? thread.updatedAt.toISOString()
        : String(thread.updatedAt ?? ""),
  };
}

// GET /messaging/communications/:id/recording
export async function streamCommunicationRecording(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(404).json({ message: "Recording not found" });
      return;
    }

    const doc = await TwilioCommunication.findById(id);
    if (!doc || doc.channel !== "voice") {
      res.status(404).json({ message: "Recording not found" });
      return;
    }

    const recordingUrl = storedTwilioRecordingUrl(doc.mediaUrls);
    if (!recordingUrl) {
      res.status(404).json({ message: "Recording not found" });
      return;
    }

    const account = doc.twilioAccountRef
      ? await TwilioAccount.findById(doc.twilioAccountRef)
      : await TwilioAccount.findOne({ accountSid: doc.accountSid });
    if (!account) {
      res.status(404).json({ message: "Recording not found" });
      return;
    }

    const rangeHeader = req.headers.range;
    const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;

    const upstream = await fetchTwilioRecordingMedia({
      account,
      recordingUrl,
      range,
    });

    if (upstream.status === 404) {
      res.status(404).json({ message: "Recording not found" });
      return;
    }
    if (upstream.status >= 400 || !upstream.body) {
      res.status(502).json({ message: "Failed to fetch recording" });
      return;
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.contentType);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "private, no-store");
    if (upstream.contentLength) {
      res.setHeader("Content-Length", upstream.contentLength);
    }
    if (upstream.contentRange) {
      res.setHeader("Content-Range", upstream.contentRange);
    }
    res.setHeader("Accept-Ranges", upstream.acceptRanges || "bytes");

    Readable.fromWeb(
      upstream.body as import("stream/web").ReadableStream,
    ).pipe(res);
  } catch (err) {
    console.error("GET /messaging/communications/:id/recording error:", err);
    if (!res.headersSent) {
      res.status(502).json({ message: "Failed to fetch recording" });
    }
  }
}

// GET /messaging/threads
export async function listThreads(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "50"), 10) || 50;
    const pageSize = PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 50;

    const filter: Record<string, unknown> = {
      ...parseAccountFilter(req.query),
    };
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
    if (req.query.status) {
      const status = String(req.query.status);
      if (["open", "closed"].includes(status)) {
        filter.status = status;
      }
    }
    if (req.query.unread === "1" || req.query.unread === "true") {
      Object.assign(filter, unreadTextQuery());
    }

    const [total, rows] = await Promise.all([
      MessageThread.countDocuments(filter),
      MessageThread.find(filter)
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const lookups = await buildThreadLookups(rows);

    res.json({
      threads: rows.map((r) => toPublicThread(r, lookups)),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /messaging/threads error:", err);
    res.status(500).json({ message: "Failed to list threads" });
  }
}

// GET /messaging/threads/check-conflict
export async function checkThreadConflict(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contactId = String(req.query.contactId ?? "");
    if (!Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contactId" });
      return;
    }
    const fromNumber = String(req.query.fromNumber ?? "");
    const ourNumber = toE164(fromNumber);
    if (!ourNumber) {
      res.status(400).json({ message: "Invalid fromNumber" });
      return;
    }
    const excludeThreadId = req.query.excludeThreadId
      ? String(req.query.excludeThreadId)
      : undefined;

    const { hasOpenThread, openThread } = await checkOpenThreadConflict({
      contactRef: new Types.ObjectId(contactId),
      ourNumber,
      excludeThreadId,
    });

    let openThreadPublic = null;
    if (openThread) {
      const lookups = await buildThreadLookups([openThread]);
      openThreadPublic = toPublicThread(
        openThread.toObject ? openThread.toObject() : openThread,
        lookups,
      );
    }

    res.json({ hasOpenThread, openThread: openThreadPublic });
  } catch (err) {
    console.error("GET /messaging/threads/check-conflict error:", err);
    res.status(500).json({ message: "Failed to check thread conflict" });
  }
}

// GET /messaging/threads/:threadId
export async function getThreadDetail(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const threadId = String(req.params.threadId);
    if (!Types.ObjectId.isValid(threadId)) {
      res.status(400).json({ message: "Invalid threadId" });
      return;
    }

    const thread = await MessageThread.findById(threadId).lean();
    if (!thread) {
      res.status(404).json({ message: "Thread not found" });
      return;
    }

    const rows = await TwilioCommunication.find({ threadRef: threadId })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();

    const [lookups, names] = await Promise.all([
      buildThreadLookups([thread]),
      accountNameMap(rows.map((r) => String(r.twilioAccountRef))),
    ]);

    res.json({
      thread: toPublicThread(thread, lookups),
      messages: rows.map((r) =>
        toPublicCommunication(r, names.get(String(r.twilioAccountRef))),
      ),
    });
  } catch (err) {
    console.error("GET /messaging/threads/:threadId error:", err);
    res.status(500).json({ message: "Failed to load thread" });
  }
}

// POST /messaging/threads/:threadId/read
export async function markThreadRead(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const threadId = String(req.params.threadId);
    if (!Types.ObjectId.isValid(threadId)) {
      res.status(400).json({ message: "Invalid threadId" });
      return;
    }
    const userId = req.user?.id;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    const now = new Date();
    const updated = await MessageThread.findOneAndUpdate(
      { _id: threadId, ...unreadTextQuery() },
      { $set: { readAt: now, readByUserRef: userId } },
      { new: true },
    ).lean();

    const thread =
      updated ?? (await MessageThread.findById(threadId).lean());
    if (!thread) {
      res.status(404).json({ message: "Thread not found" });
      return;
    }

    const lookups = await buildThreadLookups([thread]);
    res.json({ thread: toPublicThread(thread, lookups) });
  } catch (err) {
    console.error("POST /messaging/threads/:threadId/read error:", err);
    res.status(500).json({ message: "Failed to mark thread read" });
  }
}

// PATCH /messaging/threads/:threadId
export async function closeThreadEndpoint(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const threadId = String(req.params.threadId);
    if (req.body?.status !== "closed") {
      res.status(400).json({ message: 'Only status:"closed" is supported' });
      return;
    }

    const thread = await closeThread({
      threadId,
      userId: req.user?.id ?? null,
    });
    const lookups = await buildThreadLookups([thread]);
    res.json({
      thread: toPublicThread(
        thread.toObject ? thread.toObject() : thread,
        lookups,
      ),
    });
  } catch (err) {
    if (err instanceof ThreadNotFoundError) {
      res.status(404).json({ message: err.message });
      return;
    }
    console.error("PATCH /messaging/threads/:threadId error:", err);
    res.status(500).json({ message: "Failed to close thread" });
  }
}

/** Public base URL helper for Control Panel webhook hints. */
export async function getWebhookInfo(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const base = resolvePublicApiBase(req);

  const accounts = await TwilioAccount.find()
    .select("_id friendlyName accountSid isActive")
    .sort({ friendlyName: 1 })
    .lean();

  res.json({
    environment: getTwilioRuntimeEnvironment(),
    credentialsInUse: getTwilioCredentialPair(),
    messageWebhookUrl: `${base}/webhooks/twilio/message`,
    voiceWebhookUrl: `${base}/webhooks/twilio/voice`,
    recordingWebhookUrl: `${base}/webhooks/twilio/voice/recording`,
    statusWebhookUrl: `${base}/webhooks/twilio/status`,
    accounts: accounts.map((a) => ({
      _id: String(a._id),
      friendlyName: a.friendlyName,
      accountSid: a.accountSid,
      isActive: a.isActive,
      messageWebhookUrl: `${base}/webhooks/twilio/message?accountSid=${encodeURIComponent(a.accountSid)}`,
      voiceWebhookUrl: `${base}/webhooks/twilio/voice?accountSid=${encodeURIComponent(a.accountSid)}`,
      recordingWebhookUrl: `${base}/webhooks/twilio/voice/recording?accountSid=${encodeURIComponent(a.accountSid)}`,
      statusWebhookUrl: `${base}/webhooks/twilio/status?accountSid=${encodeURIComponent(a.accountSid)}`,
    })),
  });
}

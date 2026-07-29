import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Customer } from "../models/mongo/Customer";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import { MessageThread } from "../models/mongo/MessageThread";
import { env } from "../config/env";
import {
  messagingCallSchema,
  messagingPreviewSchema,
  messagingSendSchema,
} from "../schemas/messageTemplate.schema";
import {
  MERGE_FIELDS,
  renderMessageTemplate,
} from "../utils/messageTemplate";
import {
  buildTemplateContextForContact,
  contactHasValidPhone,
  customerRefsWithRenewalsInMonth,
  resolveRenewalsForCustomers,
  sampleTemplateContext,
  toE164,
  type RenewalScope,
} from "../utils/messagingContext";
import { normalizePhoneDigits } from "../utils/customerSites";
import {
  accountNameMap,
  toPublicCommunication,
} from "../utils/communicationFormat";
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
  getTwilioAccountForSend,
  resolveFromNumber,
  sendSms,
  TwilioServiceError,
} from "../services/twilio.service";

const PAGE_SIZES = new Set([25, 50, 100, 150, 200, 250]);
const SEND_CONCURRENCY = 5;
const DEFAULT_SAY_TEXT =
  "Hello, this is a call from GRAC. Please call us back at your earliest convenience.";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRenewalScope(
  yearRaw: unknown,
  monthRaw: unknown,
): { scope?: RenewalScope; error?: string } {
  if (yearRaw === undefined && monthRaw === undefined) {
    return {};
  }
  if (yearRaw === undefined || monthRaw === undefined) {
    return { error: "Both year and month are required when filtering by renewals" };
  }
  const year = parseInt(String(yearRaw), 10);
  const month = parseInt(String(monthRaw), 10);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    month < 1 ||
    month > 12 ||
    year < 1970 ||
    year > 2100
  ) {
    return { error: "Invalid year or month" };
  }
  return { scope: { year, month } };
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
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "50"), 10) || 50;
    const pageSize = PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 50;

    const renewal = parseRenewalScope(req.query.year, req.query.month);
    if (renewal.error) {
      res.status(400).json({ message: renewal.error });
      return;
    }

    let customerRefFilter: Types.ObjectId[] | null = null;
    if (renewal.scope) {
      customerRefFilter = await customerRefsWithRenewalsInMonth(renewal.scope);
      if (customerRefFilter.length === 0) {
        res.json({ contacts: [], total: 0, page, pageSize });
        return;
      }
    }

    const search = String(req.query.search ?? "").trim();
    const match: Record<string, unknown> = {
      phone: { $exists: true, $nin: [null, ""] },
    };

    if (customerRefFilter) {
      match.customerRef = { $in: customerRefFilter };
    }

    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const digits = normalizePhoneDigits(search);
      const or: Record<string, unknown>[] = [
        { first: re },
        { last: re },
        { phone: re },
        { email: re },
        { label: re },
      ];
      if (digits.length >= 3) {
        or.push({ phone: new RegExp(escapeRegex(digits), "i") });
      }

      // Also match customer denorm fields
      const customerOr: Record<string, unknown>[] = [
        { first: re },
        { last: re },
        { address: re },
        { city: re },
        { phone: re },
      ];
      if (digits.length >= 3) {
        customerOr.push({ phoneDigits: new RegExp(escapeRegex(digits)) });
      }

      const matchingCustomers = await Customer.find({
        deletedAt: null,
        $or: [
          { mergedIntoRef: null },
          { mergedIntoRef: { $exists: false } },
        ],
        $and: [{ $or: customerOr }],
      })
        .select("_id")
        .lean();

      const customerIds = matchingCustomers.map((c) => c._id);
      if (customerIds.length > 0) {
        or.push({ customerRef: { $in: customerIds } });
      }

      match.$or = or;
    }

    // Fetch a wider window then filter by valid phone digits, then page in memory.
    // Contacts without usable phones are excluded from the messaging hub.
    const candidates = await CustomerContact.find(match)
      .sort({ last: 1, first: 1 })
      .lean();

    const withPhone = candidates.filter((c) => contactHasValidPhone(c.phone));

    // Exclude contacts on deleted/merged customers
    const customerIds = [...new Set(withPhone.map((c) => String(c.customerRef)))];
    const customers = await Customer.find({
      _id: { $in: customerIds },
      deletedAt: null,
      $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
    })
      .select("_id first last address city state zip phone")
      .lean();

    const customerById = new Map(customers.map((c) => [String(c._id), c]));

    const activeContacts = withPhone.filter((c) =>
      customerById.has(String(c.customerRef)),
    );

    const total = activeContacts.length;
    const start = (page - 1) * pageSize;
    const pageRows = activeContacts.slice(start, start + pageSize);

    const renewalMap = renewal.scope
      ? await resolveRenewalsForCustomers(
          pageRows.map((c) => c.customerRef),
          renewal.scope,
        )
      : new Map();

    const contacts = pageRows.map((c) => {
      const customer = customerById.get(String(c.customerRef))!;
      const renewalInfo = renewalMap.get(String(c.customerRef)) ?? {
        renewalDueDate: null as Date | null,
        contractType: null as string | null,
      };

      return {
        _id: String(c._id),
        first: c.first ?? "",
        last: c.last ?? "",
        phone: c.phone ?? "",
        email: c.email ?? "",
        label: c.label ?? "",
        isPrimary: Boolean(c.isPrimary),
        customerRef: String(c.customerRef),
        customer: {
          _id: String(customer._id),
          accountName: customer.accountName ?? "",
          first: customer.first ?? "",
          last: customer.last ?? "",
          address: customer.address ?? "",
          city: customer.city ?? "",
          state: customer.state ?? "",
          zip: customer.zip ?? "",
          phone: customer.phone ?? "",
        },
        renewalDueDate: renewalInfo.renewalDueDate
          ? renewalInfo.renewalDueDate.toISOString()
          : null,
        contractType: renewalInfo.contractType,
      };
    });

    res.json({ contacts, total, page, pageSize });
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

    const { body, contactId, renewalYear, renewalMonth } = parsed.data;
    const scope =
      renewalYear !== undefined && renewalMonth !== undefined
        ? { year: renewalYear, month: renewalMonth }
        : undefined;

    if (contactId) {
      const built = await buildTemplateContextForContact(contactId, scope);
      if (!built) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      res.json({
        rendered: renderMessageTemplate(body, built.context),
        context: built.context,
        sample: false,
      });
      return;
    }

    const context = sampleTemplateContext();
    res.json({
      rendered: renderMessageTemplate(body, context),
      context,
      sample: true,
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

    const data = parsed.data;
    let bodyTemplate = data.body?.trim() ?? "";

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
      if (!bodyTemplate) {
        bodyTemplate = template.body ?? "";
      }
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

    const scope =
      data.renewalYear !== undefined && data.renewalMonth !== undefined
        ? { year: data.renewalYear, month: data.renewalMonth }
        : undefined;

    const uniqueContactIds = [...new Set(data.contactIds)];
    const templateRef = data.templateId ?? null;
    const userId = req.user?.id;
    const mediaUrls = data.mediaUrls ?? [];
    const channel = mediaUrls.length > 0 ? ("mms" as const) : ("sms" as const);

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

        const toE164Number = toE164(built.contact.phone);
        const rendered = renderMessageTemplate(bodyTemplate, built.context);
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
            err instanceof ThreadNotFoundError || err instanceof ThreadConflictError
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
            toNumber: built.contact.phone || "",
            body: rendered,
            mediaUrls,
            customerRef,
            contactRef,
            threadRef: thread._id,
            templateRef,
            status: "failed",
            errorMessage: "Contact phone number is invalid",
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
            error: "Contact phone number is invalid",
          };
        }

        try {
          const { sid } = await sendSms({
            account,
            from: fromNumber,
            to: toE164Number,
            body: rendered,
            mediaUrls,
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

    res.json({
      results,
      summary: { total: results.length, sent, failed },
      fromNumber,
      twilioAccountId: String(account._id),
      accountSid: account.accountSid,
      channel,
    });
  } catch (err) {
    console.error("POST /messaging/send error:", err);
    res.status(500).json({ message: "Failed to send messages" });
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
    const statusCallbackUrl = `${apiBase}/webhooks/twilio/status?accountSid=${encodeURIComponent(account.accountSid)}`;

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
        communication: toPublicCommunication(doc, account.friendlyName),
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

    if (req.query.customerId && Types.ObjectId.isValid(String(req.query.customerId))) {
      filter.customerRef = String(req.query.customerId);
    }
    if (req.query.contactId && Types.ObjectId.isValid(String(req.query.contactId))) {
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
        toPublicCommunication(
          r,
          names.get(String(r.twilioAccountRef))?.friendlyName,
        ),
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
  names: Map<string, { friendlyName: string; accountSid: string }>;
};

async function buildThreadLookups(
  threads: Array<{
    contactRef: Types.ObjectId;
    twilioAccountRef: Types.ObjectId;
  }>,
): Promise<ThreadLookups> {
  const contactIds = [...new Set(threads.map((t) => String(t.contactRef)))];
  const contacts = await CustomerContact.find({ _id: { $in: contactIds } })
    .select("_id first last phone customerRef label")
    .lean();
  const contactById = new Map(contacts.map((c) => [String(c._id), c]));

  const customerIds = [
    ...new Set(contacts.map((c) => String(c.customerRef))),
  ];
  const customers = await Customer.find({ _id: { $in: customerIds } })
    .select("_id first last")
    .lean();
  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  const names = await accountNameMap(
    threads.map((t) => String(t.twilioAccountRef)),
  );

  return { contactById, customerById, names };
}

function toPublicThread(
  thread: Record<string, unknown>,
  lookups: ThreadLookups,
) {
  const contact = lookups.contactById.get(String(thread.contactRef));
  const customer = contact
    ? lookups.customerById.get(String(contact.customerRef))
    : undefined;
  const accountFriendlyName =
    lookups.names.get(String(thread.twilioAccountRef))?.friendlyName ?? null;

  return {
    _id: String(thread._id),
    contactRef: String(thread.contactRef),
    customerRef: thread.customerRef ? String(thread.customerRef) : null,
    twilioAccountRef: String(thread.twilioAccountRef),
    accountSid: thread.accountSid ?? "",
    accountFriendlyName,
    ourNumber: thread.ourNumber ?? "",
    contactPhoneSnapshot: thread.contactPhoneSnapshot ?? "",
    status: thread.status,
    startedByUserRef: thread.startedByUserRef
      ? String(thread.startedByUserRef)
      : null,
    closedAt:
      thread.closedAt instanceof Date
        ? thread.closedAt.toISOString()
        : (thread.closedAt as string | null) ?? null,
    closedByUserRef: thread.closedByUserRef
      ? String(thread.closedByUserRef)
      : null,
    lastMessageAt:
      thread.lastMessageAt instanceof Date
        ? thread.lastMessageAt.toISOString()
        : (thread.lastMessageAt as string | null) ?? null,
    lastMessageDirection: thread.lastMessageDirection ?? null,
    lastMessageChannel: thread.lastMessageChannel ?? null,
    lastMessagePreview: thread.lastMessagePreview ?? "",
    messageCount: thread.messageCount ?? 0,
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
        toPublicCommunication(
          r,
          names.get(String(r.twilioAccountRef))?.friendlyName,
        ),
      ),
    });
  } catch (err) {
    console.error("GET /messaging/threads/:threadId error:", err);
    res.status(500).json({ message: "Failed to load thread" });
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
      res.status(400).json({ message: "Only status:\"closed\" is supported" });
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
  const host = req.get("host");
  const proto = req.protocol;
  const base =
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    (host ? `${proto}://${host}` : `http://localhost:${env.port}`);

  const accounts = await TwilioAccount.find()
    .select("_id friendlyName accountSid isActive")
    .sort({ friendlyName: 1 })
    .lean();

  res.json({
    messageWebhookUrl: `${base}/webhooks/twilio/message`,
    statusWebhookUrl: `${base}/webhooks/twilio/status`,
    accounts: accounts.map((a) => ({
      _id: String(a._id),
      friendlyName: a.friendlyName,
      accountSid: a.accountSid,
      isActive: a.isActive,
      messageWebhookUrl: `${base}/webhooks/twilio/message?accountSid=${encodeURIComponent(a.accountSid)}`,
      statusWebhookUrl: `${base}/webhooks/twilio/status?accountSid=${encodeURIComponent(a.accountSid)}`,
    })),
  });
}

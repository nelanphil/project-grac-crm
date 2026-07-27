import { Response } from "express";
import { PipelineStage, Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Customer } from "../models/mongo/Customer";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
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
  createOutboundCall,
  getTwilioAccountForSend,
  resolveFromNumber,
  sendSms,
  TwilioServiceError,
} from "../services/twilio.service";

const PAGE_SIZES = new Set([25, 50, 100, 150, 250]);
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
            customerRef: built.customer?._id ?? null,
            contactRef: built.contact._id,
            templateRef,
            status: "failed",
            errorMessage: "Contact phone number is invalid",
            createdByUserRef: userId ?? null,
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
            customerRef: built.customer?._id ?? null,
            contactRef: built.contact._id,
            templateRef,
            status: "sent",
            twilioSid: sid,
            createdByUserRef: userId ?? null,
          });

          return {
            contactId,
            status: "sent" as const,
            twilioSid: sid,
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
            customerRef: built.customer?._id ?? null,
            contactRef: built.contact._id,
            templateRef,
            status: "failed",
            errorMessage,
            createdByUserRef: userId ?? null,
          });

          return {
            contactId,
            status: "failed" as const,
            error: errorMessage,
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
        customerRef: built.customer?._id ?? null,
        contactRef: built.contact._id,
        createdByUserRef: req.user?.id ?? null,
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
        customerRef: built.customer?._id ?? null,
        contactRef: built.contact._id,
        errorMessage,
        createdByUserRef: req.user?.id ?? null,
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

// GET /messaging/conversations
export async function listConversations(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const accountFilter = parseAccountFilter(req.query);
    const match: Record<string, unknown> = {
      contactRef: { $ne: null },
      channel: { $in: ["sms", "mms", "voice"] },
      ...accountFilter,
    };

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$contactRef",
          lastMessage: { $first: "$$ROOT" },
          messageCount: { $sum: 1 },
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
      { $limit: 50 },
    ];

    const groups = await TwilioCommunication.aggregate(pipeline);
    const contactIds = groups.map((g) => g._id).filter(Boolean);
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
      groups.map((g) => String(g.lastMessage.twilioAccountRef)),
    );

    const conversations = groups
      .map((g) => {
        const contact = contactById.get(String(g._id));
        if (!contact) return null;
        const customer = customerById.get(String(contact.customerRef));
        const last = toPublicCommunication(
          g.lastMessage,
          names.get(String(g.lastMessage.twilioAccountRef))?.friendlyName,
        );
        return {
          contactId: String(contact._id),
          contact: {
            _id: String(contact._id),
            first: contact.first ?? "",
            last: contact.last ?? "",
            phone: contact.phone ?? "",
            label: contact.label ?? "",
            customerRef: String(contact.customerRef),
          },
          customer: customer
            ? {
                _id: String(customer._id),
                first: customer.first ?? "",
                last: customer.last ?? "",
              }
            : null,
          lastMessage: last,
          messageCount: g.messageCount as number,
        };
      })
      .filter(Boolean);

    res.json({ conversations });
  } catch (err) {
    console.error("GET /messaging/conversations error:", err);
    res.status(500).json({ message: "Failed to list conversations" });
  }
}

// GET /messaging/conversations/:contactId
export async function getConversationThread(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contactId = String(req.params.contactId);
    if (!Types.ObjectId.isValid(contactId)) {
      res.status(400).json({ message: "Invalid contactId" });
      return;
    }

    const contact = await CustomerContact.findById(contactId)
      .select("_id first last phone email label customerRef isPrimary")
      .lean();
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    const filter: Record<string, unknown> = {
      contactRef: contactId,
      ...parseAccountFilter(req.query),
    };

    const rows = await TwilioCommunication.find(filter)
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();

    const names = await accountNameMap(
      rows.map((r) => String(r.twilioAccountRef)),
    );

    const customer = await Customer.findById(contact.customerRef)
      .select("_id first last")
      .lean();

    res.json({
      contact: {
        _id: String(contact._id),
        first: contact.first ?? "",
        last: contact.last ?? "",
        phone: contact.phone ?? "",
        email: contact.email ?? "",
        label: contact.label ?? "",
        isPrimary: Boolean(contact.isPrimary),
        customerRef: String(contact.customerRef),
      },
      customer: customer
        ? {
            _id: String(customer._id),
            first: customer.first ?? "",
            last: customer.last ?? "",
          }
        : null,
      messages: rows.map((r) =>
        toPublicCommunication(
          r,
          names.get(String(r.twilioAccountRef))?.friendlyName,
        ),
      ),
    });
  } catch (err) {
    console.error("GET /messaging/conversations/:contactId error:", err);
    res.status(500).json({ message: "Failed to load conversation" });
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

import { NextFunction, Response } from "express";
import multer from "multer";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Customer, activeCustomerFilter } from "../models/mongo/Customer";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { CustomerNote } from "../models/mongo/CustomerNote";
import { EmailAccount } from "../models/mongo/EmailAccount";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { InboxConversation, IInboxConversation } from "../models/mongo/InboxConversation";
import { Task } from "../models/mongo/Task";
import { Invoice } from "../models/mongo/Invoice";
import { MessageTemplate } from "../models/mongo/MessageTemplate";
import { ScheduledMessageSend } from "../models/mongo/ScheduledMessageSend";
import { MessageThread } from "../models/mongo/MessageThread";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { parseTranscriptRating } from "../utils/transcriptRating";
import { User } from "../models/mongo/User";
import { WorkOrder, activeWorkOrderFilter } from "../models/mongo/WorkOrder";
import { formatFrom, sendWithEmailAccount } from "../services/email.service";
import {
  StaffEmailBatchError,
  loadActiveEmailAccount,
} from "../services/emailMessage.service";
import { recordSentMailboxEmail } from "../services/emailInboxSync.service";
import {
  ensureInboxCustomer,
  inboxPhoneHandle,
  linkInboxConversationToCustomer,
  setInboxBlocked,
  touchFromTwilio,
} from "../services/inboxConversation.service";
import { publishDashboardChanged } from "../services/dashboardLive";
import {
  MessagingDispatchError,
  dispatchMessagingBatch,
} from "../controllers/messaging.controller";
import { appendToSentFolder } from "../services/mailbox.service";
import {
  createOutboundCall,
  getTwilioAccountForSend,
  resolveFromNumber,
  sendSms,
  TwilioServiceError,
} from "../services/twilio.service";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";
import { publicMediaUrls } from "../utils/recordingPlayback";
import { isPubliclyReachableApiHost } from "../utils/publicUrl";
import { formatUsPhone } from "../utils/customerSites";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";
import { sanitizeEmailBodyHtml } from "../utils/emailChrome";
import {
  buildRfc822Message,
  composeReplyHtml,
  htmlToPlainText,
  isBlankHtml,
  renderBrandedReplyShell,
  replySubject,
  threadingHeaders,
} from "../utils/mailboxReply";
import { renderMessageTemplate } from "../utils/messageTemplate";
import {
  buildTemplateContextForContact,
  toE164,
} from "../utils/messagingContext";
import {
  resolveThreadForInbound,
  touchThreadAfterMessage,
} from "../utils/messageThreads";
import { phoneLinesMatch } from "../utils/twilioPhoneLines";
import { ScheduledAtError } from "../utils/scheduledEmail";
import {
  EmailAttachmentError,
  MAX_EMAIL_ATTACHMENTS,
  MAX_EMAIL_ATTACHMENT_BYTES,
  OutgoingEmailAttachment,
  prepareEmailAttachments,
  unpackMultipartPayload,
} from "../utils/emailAttachments";
import {
  InboxSmsInputError,
  inboxSendPreview,
  normalizeInboxMediaUrls,
  parseInboxScheduledAt,
} from "../utils/inboxSms";

const LIST_LIMIT = 40;
const TIMELINE_LIMIT = 40;
const notMerged = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function personName(user: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!user) return "";
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
}

function apiBase(req: AuthRequest): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`
  );
}

function statusCallback(req: AuthRequest, accountSid: string): string | undefined {
  const base = apiBase(req);
  if (!isPubliclyReachableApiHost(base)) return undefined;
  return `${base}/webhooks/twilio/status?accountSid=${encodeURIComponent(accountSid)}`;
}

async function loadConversation(id: string): Promise<IInboxConversation | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return InboxConversation.findById(id);
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div>${escaped.replace(/\n/g, "<br>")}</div>`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 50;

function parseRecipientField(value: unknown): { ok: string[]; invalid: string[] } {
  const parts: string[] = [];
  if (typeof value === "string") {
    for (const part of value.split(/[,;]/)) {
      const trimmed = part.trim();
      if (trimmed) parts.push(trimmed);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (trimmed) parts.push(trimmed);
    }
  }
  const ok: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.length > 320 || !EMAIL_RE.test(part)) {
      invalid.push(part);
      continue;
    }
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ok.push(part);
  }
  return { ok, invalid };
}

type PopulatedCustomer = {
  _id: Types.ObjectId;
  accountName?: string;
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
};

type PopulatedUser = {
  _id: Types.ObjectId;
  first_name?: string;
  last_name?: string;
};

function customerOf(value: unknown): PopulatedCustomer | null {
  if (!value || typeof value !== "object" || !("_id" in value)) return null;
  const row = value as PopulatedCustomer;
  if (!row.accountName && !row.first && !row.phone && !row.email) {
    if (value instanceof Types.ObjectId) return null;
  }
  return row;
}

function refId(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return String(value);
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return null;
}

function publicConversation(row: {
  _id: Types.ObjectId;
  customerRef?: unknown;
  handle: string;
  handleKind: "phone" | "email";
  displayName?: string;
  lastMessageAt?: Date | null;
  lastPreview?: string;
  lastChannel?: string | null;
  lastDirection?: string | null;
  unreadCount?: number;
  status?: string;
  readAt?: Date | null;
  readByUserRef?: unknown;
  pinnedAt?: Date | null;
  blocked?: boolean;
  ourNumber?: string;
  emailAccountRef?: Types.ObjectId | null;
}, openTaskCount = 0) {
  const customer = customerOf(row.customerRef);
  const reader =
    row.readByUserRef &&
    typeof row.readByUserRef === "object" &&
    "first_name" in (row.readByUserRef as object)
      ? (row.readByUserRef as PopulatedUser)
      : null;
  const phone =
    customer?.phone ||
    (row.handleKind === "phone" ? formatUsPhone(row.handle) : "");
  const email =
    customer?.email || (row.handleKind === "email" ? row.handle : "");
  return {
    id: String(row._id),
    customerId: customer ? String(customer._id) : refId(row.customerRef),
    displayName: customer
      ? customerDisplayName(customer)
      : row.displayName || phone || email,
    handle: row.handle,
    handleKind: row.handleKind,
    phone,
    email,
    lastMessageAt: row.lastMessageAt
      ? new Date(row.lastMessageAt).toISOString()
      : null,
    lastPreview: row.lastPreview || "",
    lastChannel: row.lastChannel || null,
    lastDirection: row.lastDirection || null,
    unreadCount: row.unreadCount || 0,
    status: row.status || "open",
    readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    readByName: personName(reader) || null,
    pinned: Boolean(row.pinnedAt),
    blocked: Boolean(row.blocked),
    openTaskCount,
    ourNumber: row.ourNumber || "",
    emailAccountId: row.emailAccountRef ? String(row.emailAccountRef) : null,
  };
}

async function openTaskCounts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await Task.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { inboxConversationRef: { $in: ids }, status: "open" } },
    { $group: { _id: "$inboxConversationRef", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

function decodeCursor(raw: string): { at: Date; id: Types.ObjectId } | null {
  const split = raw.lastIndexOf("_");
  if (split <= 0) return null;
  const at = new Date(raw.slice(0, split));
  const id = raw.slice(split + 1);
  if (Number.isNaN(at.getTime()) || !Types.ObjectId.isValid(id)) return null;
  return { at, id: new Types.ObjectId(id) };
}

function listQuery(req: AuthRequest): Record<string, unknown>[] {
  const showBlocked = req.query.blocked === "1" || req.query.blocked === "true";
  const status = String(req.query.status || "open");
  const filterName = String(req.query.filter || "");
  const channel = String(req.query.channel || "");
  const q = String(req.query.q || "").trim();
  const and: Record<string, unknown>[] = [{ deletedAt: null }];
  if (showBlocked) {
    and.push({ blocked: true });
  } else {
    and.push({ blocked: { $ne: true } });
    if (status === "open" || status === "closed") and.push({ status });
    if (filterName === "unread") and.push({ unreadCount: { $gt: 0 } });
    if (filterName === "unresponded") and.push({ lastDirection: "inbound" });
  }
  if (channel === "text") and.push({ lastChannel: { $in: ["sms", "mms"] } });
  else if (channel === "sms" || channel === "mms" || channel === "voice" || channel === "email") {
    and.push({ lastChannel: channel });
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    and.push({ $or: [{ displayName: rx }, { handle: rx }] });
  }
  return and;
}

async function loadConversationPage(filter: Record<string, unknown>, limit: number) {
  return InboxConversation.find(filter)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit)
    .populate("customerRef", "accountName first last phone email")
    .populate("readByUserRef", "first_name last_name")
    .lean();
}

export async function listInboxConversations(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const base = listQuery(req);
    const cursor = decodeCursor(String(req.query.cursor || ""));
    const pageAnd = [...base, { pinnedAt: null }];
    if (cursor) {
      pageAnd.push({
        $or: [
          { lastMessageAt: { $lt: cursor.at } },
          { lastMessageAt: cursor.at, _id: { $lt: cursor.id } },
        ],
      });
    }
    const rows = await loadConversationPage({ $and: pageAnd }, LIST_LIMIT + 1);
    const hasMore = rows.length > LIST_LIMIT;
    const page = hasMore ? rows.slice(0, LIST_LIMIT) : rows;
    const pinned = cursor
      ? []
      : await InboxConversation.find({ $and: [...base, { pinnedAt: { $ne: null } }] })
          .sort({ pinnedAt: -1, _id: -1 })
          .limit(100)
          .populate("customerRef", "accountName first last phone email")
          .populate("readByUserRef", "first_name last_name")
          .lean();
    const counts = await openTaskCounts(
      [...pinned, ...page].map((row) => row._id as Types.ObjectId),
    );
    const presentRow = (row: (typeof page)[number]) =>
      publicConversation(row as never, counts.get(String(row._id)) || 0);
    const last = page[page.length - 1];
    res.json({
      pinned: cursor ? undefined : pinned.map(presentRow),
      conversations: page.map(presentRow),
      nextCursor:
        hasMore && last?.lastMessageAt
          ? `${new Date(last.lastMessageAt).toISOString()}_${String(last._id)}`
          : null,
    });
  } catch (err) {
    console.error("GET /inboxes/conversations error:", err);
    res.status(500).json({ message: "Failed to list conversations" });
  }
}

function commFilter(convo: IInboxConversation): {
  twilio: Record<string, unknown>;
  email: Record<string, unknown>;
} {
  if (convo.customerRef) {
    return {
      twilio: { customerRef: convo.customerRef },
      email: { customerRef: convo.customerRef },
    };
  }
  if (convo.handleKind === "email") {
    const handle = normalizeAccountEmail(convo.handle);
    return {
      twilio: { _id: null },
      email: {
        customerRef: null,
        $or: [{ fromEmail: handle }, { toEmail: handle }],
      },
    };
  }
  const handle = inboxPhoneHandle(convo.handle);
  const pattern = new RegExp(`${handle}$`);
  return {
    twilio: {
      customerRef: null,
      $or: [{ fromNumber: pattern }, { toNumber: pattern }],
    },
    email: { _id: null },
  };
}

export async function getInboxTimeline(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const limitRaw = parseInt(String(req.query.limit || TIMELINE_LIMIT), 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : TIMELINE_LIMIT;
    const beforeRaw = String(req.query.before || "");
    const before = beforeRaw ? new Date(beforeRaw) : null;
    const beforeOk = before && !Number.isNaN(before.getTime()) ? before : null;
    const afterRaw = convo.historyFrom ? new Date(convo.historyFrom) : null;
    const after = afterRaw && !Number.isNaN(afterRaw.getTime()) ? afterRaw : null;
    const createdRange: { $lt?: Date; $gt?: Date } = {};
    if (beforeOk) createdRange.$lt = beforeOk;
    if (after) createdRange.$gt = after;
    const createdAt =
      createdRange.$lt || createdRange.$gt ? { createdAt: createdRange } : {};
    const match = commFilter(convo);
    const twilioQuery = { ...match.twilio, ...createdAt };
    const emailQuery = { ...match.email, ...createdAt };
    const [twilio, emails] = await Promise.all([
      match.twilio._id === null
        ? Promise.resolve([])
        : TwilioCommunication.find(twilioQuery)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .lean(),
      match.email._id === null
        ? Promise.resolve([])
        : EmailCommunication.find(emailQuery)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .lean(),
    ]);
    type Item = {
      id: string;
      channel: string;
      direction: string;
      at: string;
      atMs: number;
      body: string;
      html: string;
      subject: string;
      status: string;
      from: string;
      to: string;
      senderName: string;
      mediaUrls: string[];
      attachments: { filename: string; size: number; contentType: string; partId: string }[];
      durationSeconds: number | null;
      transcript: string;
      transcriptStatus: string;
      callSummary: string;
      suggestedTask: { title: string; description: string; dueInDays: number | null } | null;
      transcriptRating: { stars: number; comment: string } | null;
      followUpTask: { id: string; title: string } | null;
      taskPromptDismissed: boolean;
      emailAccountId: string | null;
      imapUid: number | null;
      actorId: string | null;
    };
    const followUpIds = twilio.flatMap((doc) =>
      doc.followUpTaskRef ? [doc.followUpTaskRef] : [],
    );
    const followUpTasks = followUpIds.length
      ? await Task.find({ _id: { $in: followUpIds } }).select("title").lean()
      : [];
    const followUpTitles = new Map(followUpTasks.map((task) => [String(task._id), task.title]));
    const items: Item[] = [
      ...twilio.map((doc) => ({
        id: String(doc._id),
        channel: doc.channel,
        direction: doc.direction,
        at: new Date(doc.createdAt).toISOString(),
        atMs: new Date(doc.createdAt).getTime(),
        body: doc.body || "",
        html: "",
        subject: "",
        status: doc.status,
        from: doc.fromNumber || "",
        to: doc.toNumber || "",
        senderName: "",
        mediaUrls: publicMediaUrls(doc),
        attachments: [],
        durationSeconds: doc.durationSeconds ?? null,
        transcript: doc.transcript || "",
        transcriptStatus: doc.channel === "voice" ? doc.transcriptStatus || "none" : "none",
        callSummary: doc.callSummary || "",
        suggestedTask:
          doc.suggestedTask?.title
            ? {
                title: doc.suggestedTask.title,
                description: doc.suggestedTask.description || "",
                dueInDays: doc.suggestedTask.dueInDays ?? null,
              }
            : null,
        transcriptRating:
          doc.transcriptRating?.stars
            ? {
                stars: doc.transcriptRating.stars,
                comment: doc.transcriptRating.comment || "",
              }
            : null,
        followUpTask: doc.followUpTaskRef
          ? {
              id: String(doc.followUpTaskRef),
              title: followUpTitles.get(String(doc.followUpTaskRef)) || "Task",
            }
          : null,
        taskPromptDismissed: Boolean(doc.taskPromptDismissedAt),
        emailAccountId: null,
        imapUid: null,
        actorId: doc.createdByUserRef ? String(doc.createdByUserRef) : null,
      })),
      ...emails.map((doc) => {
        const at = doc.receivedAt ? new Date(doc.receivedAt) : new Date(doc.createdAt);
        return {
          id: String(doc._id),
          channel: "email",
          direction: doc.direction || "outbound",
          at: at.toISOString(),
          atMs: at.getTime(),
          body: doc.body || "",
          html: doc.html || "",
          subject: doc.subject || "",
          status: doc.status,
          from: doc.fromEmail || "",
          to: doc.toEmail || "",
          senderName: doc.direction === "inbound" ? doc.fromName || "" : "",
          mediaUrls: [],
          attachments: (doc.attachments ?? []).map((file) => ({
            filename: file.filename,
            size: file.size,
            contentType: file.contentType,
            partId: file.partId,
          })),
          durationSeconds: null,
          transcript: "",
          transcriptStatus: "none",
          callSummary: "",
          suggestedTask: null,
          transcriptRating: null,
          followUpTask: null,
          taskPromptDismissed: false,
          emailAccountId: doc.emailAccountRef ? String(doc.emailAccountRef) : null,
          imapUid: doc.imapUid ?? null,
          actorId: doc.createdByUserRef ? String(doc.createdByUserRef) : null,
        };
      }),
    ];
    items.sort((left, right) => right.atMs - left.atMs);
    const hasMore = items.length > limit || twilio.length > limit || emails.length > limit;
    const page = items.slice(0, limit).reverse();
    const actorIds = [...new Set(page.map((item) => item.actorId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await User.find({ _id: { $in: actorIds } }).select("first_name last_name").lean()
      : [];
    const actorNames = new Map(actors.map((user) => [String(user._id), personName(user)]));
    const populated = await InboxConversation.findById(convo._id)
      .populate("customerRef", "accountName first last phone email")
      .populate("readByUserRef", "first_name last_name")
      .lean();
    const counts = populated ? await openTaskCounts([populated._id as Types.ObjectId]) : new Map();
    res.json({
      conversation: populated
        ? publicConversation(populated as never, counts.get(String(populated._id)) || 0)
        : null,
      messages: page.map(({ atMs: _atMs, actorId, ...item }) => ({
        ...item,
        senderName:
          item.senderName ||
          (item.direction === "outbound" ? actorNames.get(actorId || "") || "You" : ""),
      })),
      hasMore,
      nextBefore: page[0]?.at ?? null,
    });
  } catch (err) {
    console.error("GET /inboxes/conversations/:id/timeline error:", err);
    res.status(500).json({ message: "Failed to load the conversation" });
  }
}

async function present(id: Types.ObjectId, res: Response): Promise<void> {
  const row = await InboxConversation.findById(id)
    .populate("customerRef", "accountName first last phone email")
    .populate("readByUserRef", "first_name last_name")
    .lean();
  if (!row) {
    res.status(404).json({ message: "Conversation not found" });
    return;
  }
  const counts = await openTaskCounts([row._id as Types.ObjectId]);
  res.json({
    conversation: publicConversation(row as never, counts.get(String(row._id)) || 0),
  });
}

function actorId(req: AuthRequest): Types.ObjectId | null {
  return req.user?.id && Types.ObjectId.isValid(req.user.id)
    ? new Types.ObjectId(req.user.id)
    : null;
}

export async function markInboxRead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const userId = req.user?.id && Types.ObjectId.isValid(req.user.id)
      ? new Types.ObjectId(req.user.id)
      : null;
    convo.unreadCount = 0;
    convo.readAt = new Date();
    convo.readByUserRef = userId;
    await convo.save();
    if (convo.customerRef) {
      await MessageThread.updateMany(
        {
          customerRef: convo.customerRef,
          lastMessageDirection: "inbound",
          readAt: null,
        },
        { $set: { readAt: convo.readAt, readByUserRef: userId } },
      );
    }
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/read error:", err);
    res.status(500).json({ message: "Failed to mark the conversation read" });
  }
}

export async function closeInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    convo.status = "closed";
    convo.closedAt = new Date();
    convo.closedByUserRef =
      req.user?.id && Types.ObjectId.isValid(req.user.id)
        ? new Types.ObjectId(req.user.id)
        : null;
    await convo.save();
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/close error:", err);
    res.status(500).json({ message: "Failed to close the conversation" });
  }
}

export async function reopenInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    convo.status = "open";
    convo.closedAt = null;
    convo.closedByUserRef = null;
    await convo.save();
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/reopen error:", err);
    res.status(500).json({ message: "Failed to reopen the conversation" });
  }
}

export async function markInboxUnread(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    convo.unreadCount = Math.max(1, convo.unreadCount || 0);
    convo.readAt = null;
    convo.readByUserRef = null;
    await convo.save();
    publishDashboardChanged();
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/unread error:", err);
    res.status(500).json({ message: "Failed to mark the conversation unread" });
  }
}

export async function pinInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    convo.pinnedAt = new Date();
    convo.pinnedByUserRef = actorId(req);
    await convo.save();
    publishDashboardChanged();
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/pin error:", err);
    res.status(500).json({ message: "Failed to pin the conversation" });
  }
}

export async function unpinInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    convo.pinnedAt = null;
    convo.pinnedByUserRef = null;
    await convo.save();
    publishDashboardChanged();
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/unpin error:", err);
    res.status(500).json({ message: "Failed to unpin the conversation" });
  }
}

export async function blockInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    await setInboxBlocked(convo, true, req.user?.id ?? null);
    publishDashboardChanged();
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/block error:", err);
    res.status(500).json({ message: "Failed to block the conversation" });
  }
}

export async function unblockInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    await setInboxBlocked(convo, false, req.user?.id ?? null);
    publishDashboardChanged();
    await present(convo._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/unblock error:", err);
    res.status(500).json({ message: "Failed to unblock the conversation" });
  }
}

export async function deleteInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    convo.deletedAt = new Date();
    await convo.save();
    publishDashboardChanged();
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /inboxes/conversations/:id error:", err);
    res.status(500).json({ message: "Failed to delete the conversation" });
  }
}

async function contactForSend(
  convo: IInboxConversation,
  contactId: string | undefined,
  address: string | undefined,
  kind: "phone" | "email",
): Promise<CustomerContactMatch | null> {
  if (!convo.customerRef) return null;
  const contacts = await CustomerContact.find({
    customerRef: convo.customerRef,
    ...activeContactFilter,
  })
    .sort({ isPrimary: -1 })
    .lean();
  if (contactId) {
    return contacts.find((contact) => String(contact._id) === contactId) ?? null;
  }
  if (address) {
    const match = contacts.find((contact) =>
      kind === "phone"
        ? phoneLinesMatch(contact.phone || "", address)
        : normalizeAccountEmail(contact.email || "") === normalizeAccountEmail(address),
    );
    if (match) return match;
  }
  return (
    contacts.find((contact) => (kind === "phone" ? contact.phone : contact.email)) ??
    null
  );
}

type CustomerContactMatch = {
  _id: Types.ObjectId;
  phone?: string;
  email?: string;
  first?: string;
  last?: string;
};

type InboxSmsInput = {
  body?: unknown;
  mediaUrls?: unknown;
  templateId?: unknown;
  contactId?: unknown;
  toNumber?: unknown;
  fromNumber?: unknown;
  twilioAccountId?: unknown;
};

export type InboxSmsSendResult = {
  summary: { total: number; sent: number; failed: number };
  errorMessage?: string | null;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inboxSendError(err: unknown, res: Response, logLabel: string): boolean {
  if (
    err instanceof InboxSmsInputError ||
    err instanceof MessagingDispatchError ||
    err instanceof StaffEmailBatchError ||
    err instanceof ScheduledAtError
  ) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  if (err instanceof TwilioServiceError) {
    res.status(400).json({ message: err.message });
    return true;
  }
  console.error(logLabel, err);
  return false;
}

async function assertSmsTemplate(templateId: string | undefined): Promise<void> {
  if (!templateId) return;
  if (!Types.ObjectId.isValid(templateId)) {
    throw new InboxSmsInputError("Invalid template");
  }
  const template = await MessageTemplate.findById(templateId)
    .select("templateType deletedAt")
    .lean();
  if (!template || template.deletedAt) {
    throw new InboxSmsInputError("Message template not found");
  }
  if (template.templateType === "email") {
    throw new InboxSmsInputError("Cannot send an email template as SMS");
  }
}

export async function sendInboxSmsCore(
  convoId: string,
  input: InboxSmsInput,
  actor: { userId: string | null; apiBase: string },
): Promise<InboxSmsSendResult> {
  const convo = await loadConversation(convoId);
  if (!convo) {
    throw new MessagingDispatchError(404, "Conversation not found");
  }
  const body = typeof input.body === "string" ? input.body : "";
  const text = body.trim();
  if (text.length > 1600) {
    throw new InboxSmsInputError("Message is too long");
  }
  const mediaUrls = normalizeInboxMediaUrls(input.mediaUrls);
  const templateId = optionalString(input.templateId);
  const contactId = optionalString(input.contactId);
  const toNumber = optionalString(input.toNumber);
  const fromNumber = optionalString(input.fromNumber);
  const twilioAccountId = optionalString(input.twilioAccountId);
  if (!text && mediaUrls.length === 0 && !templateId) {
    throw new InboxSmsInputError("Write a message before sending.");
  }
  await assertSmsTemplate(templateId);
  const contact = await contactForSend(convo, contactId, toNumber, "phone");
  if (contact) {
    const result = await dispatchMessagingBatch(
      {
        contactIds: [String(contact._id)],
        body: text,
        mediaUrls,
        templateId,
        twilioAccountId,
        fromNumber: fromNumber || convo.ourNumber || undefined,
        toOverride: toNumber,
      },
      { userId: actor.userId, apiBase: actor.apiBase },
    );
    const failed = result.results.find((item) => item.status === "failed");
    return {
      summary: result.summary,
      errorMessage: failed && "error" in failed ? failed.error : null,
    };
  }
  if (!text && mediaUrls.length === 0) {
    throw new InboxSmsInputError("Write a message before sending.");
  }
  const rawTo = toNumber || (convo.handleKind === "phone" ? convo.handle : "");
  const to = toE164(rawTo);
  if (!to) {
    throw new InboxSmsInputError("This conversation has no phone number.");
  }
  const account = await getTwilioAccountForSend(twilioAccountId);
  const from = resolveFromNumber(account, fromNumber || convo.ourNumber || undefined);
  const thread = await resolveThreadForInbound({
    contactRef: null,
    customerRef: null,
    twilioAccountRef: account._id,
    accountSid: account.accountSid,
    ourNumber: from,
    contactPhoneSnapshot: rawTo,
  });
  const channel = mediaUrls.length > 0 ? "mms" : "sms";
  const preview = inboxSendPreview(text, mediaUrls.length);
  const base = actor.apiBase.replace(/\/$/, "");
  const callback = isPubliclyReachableApiHost(base)
    ? `${base}/webhooks/twilio/status?accountSid=${encodeURIComponent(account.accountSid)}`
    : undefined;
  const { sid } = await sendSms({
    account,
    from,
    to,
    body: text,
    mediaUrls,
    statusCallbackUrl: callback,
  });
  const doc = await TwilioCommunication.create({
    twilioAccountRef: account._id,
    accountSid: account.accountSid,
    channel,
    direction: "outbound",
    status: "sent",
    fromNumber: from,
    toNumber: to,
    body: text,
    mediaUrls,
    twilioSid: sid,
    threadRef: thread._id,
    createdByUserRef: actor.userId,
  });
  await touchThreadAfterMessage(thread._id, {
    direction: "outbound",
    channel,
    body: preview,
    at: new Date(),
  });
  await touchFromTwilio(doc, {
    countUnread: false,
    publish: true,
    actorUserId: actor.userId,
  });
  return { summary: { total: 1, sent: 1, failed: 0 }, errorMessage: null };
}

export async function sendInboxSms(req: AuthRequest, res: Response): Promise<void> {
  try {
    const result = await sendInboxSmsCore(
      String(req.params.id),
      req.body ?? {},
      { userId: req.user?.id ?? null, apiBase: apiBase(req) },
    );
    res.json(result);
  } catch (err) {
    if (inboxSendError(err, res, "POST /inboxes/conversations/:id/sms error:")) return;
    res.status(500).json({ message: "Failed to send the text" });
  }
}

function publicInboxScheduled(row: {
  _id: Types.ObjectId;
  body?: string;
  mediaUrls?: string[];
  scheduledAt: Date;
  status: string;
}) {
  return {
    id: String(row._id),
    body: row.body || "",
    mediaUrls: row.mediaUrls ?? [],
    scheduledAt: new Date(row.scheduledAt).toISOString(),
    status: row.status,
  };
}

export async function scheduleInboxSms(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const body = typeof req.body?.body === "string" ? req.body.body : "";
    const text = body.trim();
    if (text.length > 1600) {
      throw new InboxSmsInputError("Message is too long");
    }
    const mediaUrls = normalizeInboxMediaUrls(req.body?.mediaUrls);
    const templateId = optionalString(req.body?.templateId);
    const contactId = optionalString(req.body?.contactId);
    const toNumber = optionalString(req.body?.toNumber);
    const fromNumber = optionalString(req.body?.fromNumber);
    const twilioAccountId = optionalString(req.body?.twilioAccountId);
    if (!text && mediaUrls.length === 0 && !templateId) {
      throw new InboxSmsInputError("Write a message before sending.");
    }
    await assertSmsTemplate(templateId);
    const scheduledAt = parseInboxScheduledAt(req.body?.scheduledAt);
    const contact = await contactForSend(convo, contactId, toNumber, "phone");
    if (!contact) {
      if (!text && mediaUrls.length === 0) {
        throw new InboxSmsInputError("Write a message before sending.");
      }
      const rawTo = toNumber || (convo.handleKind === "phone" ? convo.handle : "");
      if (!toE164(rawTo)) {
        throw new InboxSmsInputError("This conversation has no phone number.");
      }
    }
    const account = await getTwilioAccountForSend(twilioAccountId);
    const from = resolveFromNumber(account, fromNumber || convo.ourNumber || undefined);
    const userId =
      req.user?.id && Types.ObjectId.isValid(req.user.id)
        ? new Types.ObjectId(req.user.id)
        : null;
    const row = await ScheduledMessageSend.create({
      contactIds: contact ? [String(contact._id)] : [],
      body: text,
      templateRef: templateId ? new Types.ObjectId(templateId) : null,
      twilioAccountRef: account._id,
      fromNumber: from,
      mediaUrls,
      inboxConversationRef: convo._id,
      contactRef: contact?._id ?? null,
      toNumber: toNumber || "",
      scheduledAt,
      status: "scheduled",
      createdByUserRef: userId,
    });
    publishDashboardChanged();
    res.status(201).json({ scheduled: publicInboxScheduled(row) });
  } catch (err) {
    if (inboxSendError(err, res, "POST /inboxes/conversations/:id/sms/schedule error:")) return;
    res.status(500).json({ message: "Failed to schedule the text" });
  }
}

export async function listInboxScheduled(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const rows = await ScheduledMessageSend.find({
      inboxConversationRef: convo._id,
      status: "scheduled",
    })
      .sort({ scheduledAt: 1 })
      .limit(20)
      .lean();
    res.json({ scheduled: rows.map((row) => publicInboxScheduled(row)) });
  } catch (err) {
    console.error("GET /inboxes/conversations/:id/scheduled error:", err);
    res.status(500).json({ message: "Failed to load scheduled texts" });
  }
}

export async function cancelInboxScheduled(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.scheduledId);
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid scheduled message id" });
      return;
    }
    const row = await ScheduledMessageSend.findOne({
      _id: id,
      inboxConversationRef: { $ne: null },
    });
    if (!row) {
      res.status(404).json({ message: "Scheduled text not found" });
      return;
    }
    if (row.status !== "scheduled") {
      res.status(400).json({ message: "Only upcoming texts can be cancelled" });
      return;
    }
    row.status = "cancelled";
    row.cancelledAt = new Date();
    await row.save();
    publishDashboardChanged();
    res.json({ scheduled: publicInboxScheduled(row) });
  } catch (err) {
    console.error("POST /inboxes/scheduled/:scheduledId/cancel error:", err);
    res.status(500).json({ message: "Failed to cancel the scheduled text" });
  }
}

const emailAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EMAIL_ATTACHMENT_BYTES, files: MAX_EMAIL_ATTACHMENTS },
});

function multerErrorMessage(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: string }).code
      : undefined;
  if (code === "LIMIT_FILE_SIZE") return "Attachments must total 20 MB or less.";
  if (code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
    return `You can attach up to ${MAX_EMAIL_ATTACHMENTS} files.`;
  }
  return err instanceof Error ? err.message : "Upload failed.";
}

export function uploadInboxEmailAttachmentsMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }
  emailAttachmentUpload.array("attachments", MAX_EMAIL_ATTACHMENTS)(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ message: multerErrorMessage(err) });
      return;
    }
    try {
      req.body = unpackMultipartPayload(req.body);
    } catch (parseErr) {
      res.status(400).json({
        message: parseErr instanceof Error ? parseErr.message : "Invalid form data.",
      });
      return;
    }
    next();
  });
}

export async function sendInboxEmail(req: AuthRequest, res: Response): Promise<void> {
  try {
    const uploaded = (req as AuthRequest & { files?: Express.Multer.File[] }).files;
    const attachments: OutgoingEmailAttachment[] = Array.isArray(uploaded)
      ? prepareEmailAttachments(uploaded)
      : [];
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const emailAccountId = String(req.body?.emailAccountId || convo.emailAccountRef || "");
    if (!emailAccountId) {
      res.status(400).json({ message: "Choose an email account." });
      return;
    }
    const contactId = typeof req.body?.contactId === "string" ? req.body.contactId : undefined;
    const toField = parseRecipientField(req.body?.to);
    const ccField = parseRecipientField(req.body?.cc);
    const bccField = parseRecipientField(req.body?.bcc);
    if (
      toField.invalid.length > 0 ||
      ccField.invalid.length > 0 ||
      bccField.invalid.length > 0
    ) {
      res.status(400).json({ message: "Enter valid email addresses." });
      return;
    }
    if (
      toField.ok.length > MAX_RECIPIENTS ||
      ccField.ok.length > MAX_RECIPIENTS ||
      bccField.ok.length > MAX_RECIPIENTS
    ) {
      res.status(400).json({ message: "Too many recipients." });
      return;
    }
    const contact = await contactForSend(convo, contactId, toField.ok[0], "email");
    const toList = [...toField.ok];
    if (toList.length === 0) {
      const fallback = normalizeAccountEmail(
        contact?.email || (convo.handleKind === "email" ? convo.handle : ""),
      );
      if (fallback) toList.push(fallback);
    }
    if (toList.length === 0) {
      res.status(400).json({ message: "This conversation has no email address." });
      return;
    }
    const rawHtml = typeof req.body?.html === "string" ? req.body.html : "";
    const hasHtml = rawHtml.trim().length > 0;
    let subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    let text = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const templateId = typeof req.body?.templateId === "string" ? req.body.templateId : "";
    if (templateId && Types.ObjectId.isValid(templateId) && ((!hasHtml && !text) || !subject)) {
      const template = await MessageTemplate.findOne({
        _id: templateId,
        deletedAt: null,
        templateType: "email",
      }).lean();
      if (template) {
        if (!subject) subject = template.subject || "";
        if (!hasHtml && !text) text = template.body || "";
        if (contact) {
          const built = await buildTemplateContextForContact(String(contact._id));
          if (built) {
            subject = renderMessageTemplate(subject, built.context);
            if (!hasHtml) text = renderMessageTemplate(text, built.context);
          }
        }
      }
    }
    const match = commFilter(convo);
    const latest = match.email._id === null
      ? null
      : await EmailCommunication.findOne({ ...match.email, direction: "inbound" })
          .sort({ createdAt: -1 })
          .lean();
    if (!subject && latest?.subject) subject = replySubject(latest.subject, "reply");
    if (!subject) {
      res.status(400).json({ message: "Add a subject." });
      return;
    }
    if (subject.length > 300) {
      res.status(400).json({ message: "Subject is too long." });
      return;
    }
    const useBrandTemplate = req.body?.useBrandTemplate !== false;
    const includeQuoted = req.body?.includeQuoted !== false;
    let html: string;
    if (hasHtml) {
      if (rawHtml.length > 100_000) {
        res.status(400).json({ message: "Message is too long." });
        return;
      }
      const bodyHtml = sanitizeEmailBodyHtml(rawHtml);
      if (isBlankHtml(bodyHtml)) {
        res.status(400).json({ message: "Write a message before sending." });
        return;
      }
      const quotedAt = latest?.receivedAt ?? latest?.createdAt ?? null;
      html =
        latest && includeQuoted
          ? composeReplyHtml({
              mode: "reply",
              bodyHtml,
              useBrandTemplate,
              original: {
                html: latest.html || "",
                text: latest.body || "",
                from: [{ name: latest.fromName || "", address: latest.fromEmail || "" }],
                to: [{ name: "", address: latest.toEmail || "" }],
                date: quotedAt ? new Date(quotedAt).toISOString() : null,
                subject: latest.subject || "",
              },
            })
          : useBrandTemplate
            ? renderBrandedReplyShell(bodyHtml)
            : bodyHtml;
      text = htmlToPlainText(html);
    } else {
      if (!text) {
        res.status(400).json({ message: "Write a message before sending." });
        return;
      }
      html = textToHtml(text);
    }
    const account = await loadActiveEmailAccount(emailAccountId);
    const headers = latest?.messageId
      ? threadingHeaders({
          messageId: latest.messageId,
          references: latest.references ?? [],
        })
      : {};
    const sent = await sendWithEmailAccount(account, {
      to: toList.join(", "),
      cc: ccField.ok.length > 0 ? ccField.ok.join(", ") : undefined,
      bcc: bccField.ok.length > 0 ? bccField.ok.join(", ") : undefined,
      subject,
      text,
      html,
      headers,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    const userId =
      req.user?.id && Types.ObjectId.isValid(req.user.id)
        ? new Types.ObjectId(req.user.id)
        : null;
    await recordSentMailboxEmail({
      account,
      to: toList,
      subject,
      html,
      text,
      messageId: sent.messageId,
      inReplyTo: headers["In-Reply-To"],
      references: headers.References ? headers.References.split(/\s+/) : [],
      customerRef: convo.customerRef,
      contactRef: contact?._id ?? null,
      createdByUserRef: userId,
      attachments: attachments.map((file) => ({
        filename: file.filename,
        size: file.content.length,
        contentType: file.contentType,
      })),
    });
    try {
      const raw = buildRfc822Message({
        from: formatFrom(account.fromName, account.fromEmail),
        to: toList,
        cc: ccField.ok,
        subject,
        text,
        html,
        headers,
        messageId: sent.messageId,
        attachments,
      });
      await appendToSentFolder(account, raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sent copy failed.";
      console.error("[inboxes] could not append sent copy:", message);
    }
    res.json({ sent: true });
  } catch (err) {
    if (err instanceof StaffEmailBatchError || err instanceof EmailAttachmentError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    console.error("POST /inboxes/conversations/:id/email error:", err);
    res.status(500).json({ message: "Failed to send the email" });
  }
}

export async function callInboxConversation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const contactId = typeof req.body?.contactId === "string" ? req.body.contactId : undefined;
    const contact = await contactForSend(convo, contactId, undefined, "phone");
    const rawTo = contact?.phone || (convo.handleKind === "phone" ? convo.handle : "");
    const to = toE164(rawTo);
    if (!to) {
      res.status(400).json({ message: "This conversation has no phone number." });
      return;
    }
    const fromNumber = typeof req.body?.fromNumber === "string" ? req.body.fromNumber : undefined;
    const twilioAccountId =
      typeof req.body?.twilioAccountId === "string" ? req.body.twilioAccountId : undefined;
    const account = await getTwilioAccountForSend(twilioAccountId);
    const from = resolveFromNumber(account, fromNumber || convo.ourNumber || undefined);
    const sayText =
      (typeof req.body?.sayText === "string" && req.body.sayText.trim()) ||
      "Hello, this is a call from GRAC. Please call us back at your earliest convenience.";
    const customerRef = convo.customerRef;
    const thread = contact
      ? await resolveThreadForInbound({
          contactRef: contact._id,
          customerRef,
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          ourNumber: from,
          contactPhoneSnapshot: contact.phone || rawTo,
        })
      : await resolveThreadForInbound({
          contactRef: null,
          customerRef: null,
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          ourNumber: from,
          contactPhoneSnapshot: rawTo,
        });
    const { sid } = await createOutboundCall({
      account,
      from,
      to,
      sayText,
      voice: account.sayVoice,
      statusCallbackUrl: statusCallback(req, account.accountSid),
    });
    const doc = await TwilioCommunication.create({
      twilioAccountRef: account._id,
      accountSid: account.accountSid,
      channel: "voice",
      direction: "outbound",
      status: "queued",
      fromNumber: from,
      toNumber: to,
      body: sayText,
      mediaUrls: [],
      twilioSid: sid,
      customerRef: contact ? customerRef : null,
      contactRef: contact?._id ?? null,
      threadRef: thread._id,
      createdByUserRef: req.user?.id ?? null,
    });
    await touchThreadAfterMessage(thread._id, {
      direction: "outbound",
      channel: "voice",
      body: sayText,
      at: new Date(),
    });
    await touchFromTwilio(doc, {
      countUnread: false,
      publish: true,
      actorUserId: req.user?.id ?? null,
    });
    res.status(201).json({ sent: true });
  } catch (err) {
    if (err instanceof TwilioServiceError) {
      res.status(400).json({ message: err.message });
      return;
    }
    console.error("POST /inboxes/conversations/:id/call error:", err);
    res.status(500).json({ message: "Failed to place the call" });
  }
}

export async function linkInboxCustomer(req: AuthRequest, res: Response): Promise<void> {
  try {
    const convo = await loadConversation(String(req.params.id));
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    if (convo.customerRef) {
      res.status(400).json({ message: "This conversation is already linked to a customer." });
      return;
    }
    const customerId = String(req.body?.customerId || "");
    if (!Types.ObjectId.isValid(customerId)) {
      res.status(400).json({ message: "Choose a customer." });
      return;
    }
    const customer = await Customer.findOne({
      _id: customerId,
      ...activeCustomerFilter,
      ...notMerged,
    }).lean();
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    const linked = await linkInboxConversationToCustomer(convo, customer._id);
    await present(linked._id, res);
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/link-customer error:", err);
    res.status(500).json({ message: "Failed to link the customer" });
  }
}

export async function getInboxContext(req: AuthRequest, res: Response): Promise<void> {
  try {
    const loaded = await loadConversation(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }
    const convo = await ensureInboxCustomer(loaded);
    const moved =
      String(convo._id) !== String(loaded._id) ? String(convo._id) : undefined;
    if (!convo.customerRef) {
      res.json({
        customer: null,
        contacts: [],
        workOrders: [],
        invoices: [],
        notes: [],
        conversationId: moved,
      });
      return;
    }
    const customer = await Customer.findById(convo.customerRef)
      .select("accountName first last phone email address city state zip")
      .lean();
    if (!customer) {
      res.json({ customer: null, contacts: [], workOrders: [], invoices: [], notes: [] });
      return;
    }
    const [contacts, workOrders, invoices, notes] = await Promise.all([
      CustomerContact.find({ customerRef: customer._id, ...activeContactFilter })
        .sort({ isPrimary: -1, first: 1 })
        .select("first last phone email label isPrimary")
        .lean(),
      WorkOrder.find({
        customerRef: customer._id,
        ...activeWorkOrderFilter,
        completed: { $ne: true },
        appointmentCanceledAt: null,
      })
        .sort({ scheduledStart: -1, createdAt: -1 })
        .limit(8)
        .select("number descPerform scheduledStart total")
        .lean(),
      Invoice.find({ customerRef: customer._id, status: "open" })
        .sort({ dueDate: 1, createdAt: -1 })
        .limit(8)
        .select("number amountCents status dueDate")
        .lean(),
      CustomerNote.find({ customerRef: customer._id })
        .sort({ createdAt: -1 })
        .limit(30)
        .populate("authorId", "first_name last_name")
        .lean(),
    ]);
    res.json({
      customer: {
        id: String(customer._id),
        name: customerDisplayName(customer),
        phone: customer.phone || "",
        email: customer.email || "",
        address: [customer.address, customer.city, customer.state, customer.zip]
          .filter(Boolean)
          .join(", "),
      },
      contacts: contacts.map((contact) => ({
        id: String(contact._id),
        name: `${contact.first || ""} ${contact.last || ""}`.trim() || "Contact",
        phone: contact.phone || "",
        email: contact.email || "",
        label: contact.label || "",
        isPrimary: Boolean(contact.isPrimary),
      })),
      workOrders: workOrders.map((order) => ({
        id: String(order._id),
        number: order.number || "",
        summary: order.descPerform || "Work order",
        scheduledStart: order.scheduledStart
          ? new Date(order.scheduledStart).toISOString()
          : null,
        total: order.total ?? 0,
      })),
      invoices: invoices.map((invoice) => ({
        id: String(invoice._id),
        number: invoice.number,
        amountCents: invoice.amountCents,
        status: invoice.status,
        dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString() : null,
      })),
      notes: notes.map((note) => {
        const author = note.authorId as unknown as PopulatedUser | Types.ObjectId;
        return {
          id: String(note._id),
          content: note.content,
          authorName:
            author && typeof author === "object" && "first_name" in author
              ? personName(author)
              : "",
          createdAt: new Date(note.createdAt).toISOString(),
        };
      }),
      conversationId: moved,
    });
  } catch (err) {
    console.error("GET /inboxes/conversations/:id/context error:", err);
    res.status(500).json({ message: "Failed to load the customer" });
  }
}

export async function addInboxNote(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const convo = await loadConversation(String(req.params.id));
    if (!convo?.customerRef) {
      res.status(400).json({ message: "Link a customer before adding a note." });
      return;
    }
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content) {
      res.status(400).json({ message: "Write a note first." });
      return;
    }
    const customer = await Customer.findById(convo.customerRef)
      .select("accountName first last")
      .lean();
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    const author = await User.findById(req.user.id)
      .select("first_name last_name")
      .lean();
    const note = await CustomerNote.create({
      customerRef: customer._id,
      authorId: req.user.id,
      content,
      viewedAt: null,
    });
    logNotificationAsync({
      entityType: "customer_note",
      action: "created",
      entityId: String(note._id),
      customerRef: customer._id,
      summary: `Note added for ${customerDisplayName(customer)}`,
      metadata: { customerName: customerDisplayName(customer) },
      ...actorFromRequest(req.user),
    });
    res.status(201).json({
      note: {
        id: String(note._id),
        content: note.content,
        authorName: personName(author),
        createdAt: note.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("POST /inboxes/conversations/:id/context error:", err);
    res.status(500).json({ message: "Failed to add the note" });
  }
}

export async function searchInboxCustomers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      res.json({ customers: [] });
      return;
    }
    const rx = new RegExp(escapeRegex(q), "i");
    const or: Record<string, unknown>[] = [
      { accountName: rx },
      { first: rx },
      { last: rx },
      { email: rx },
    ];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ phoneDigits: new RegExp(digits) });
    const rows = await Customer.find({
      ...activeCustomerFilter,
      ...notMerged,
      $or: or,
    })
      .select("accountName first last phone email")
      .limit(8)
      .lean();
    res.json({
      customers: rows.map((row) => ({
        id: String(row._id),
        name: customerDisplayName(row),
        phone: row.phone || "",
        email: row.email || "",
      })),
    });
  } catch (err) {
    console.error("GET /inboxes/customers error:", err);
    res.status(500).json({ message: "Failed to search customers" });
  }
}

export async function listInboxChannels(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const [twilio, email] = await Promise.all([
      TwilioAccount.find({ isActive: true })
        .select(
          "friendlyName phoneNumbers voiceApiKeySid voiceApiKeySecretEncrypted voiceTwimlAppSid",
        )
        .sort({ friendlyName: 1 })
        .lean(),
      EmailAccount.find({ isActive: true })
        .select("friendlyName fromEmail fromName")
        .sort({ friendlyName: 1 })
        .lean(),
    ]);
    res.json({
      twilioAccounts: twilio.map((account) => ({
        id: String(account._id),
        friendlyName: account.friendlyName,
        browserCalling: Boolean(
          account.voiceApiKeySid &&
            account.voiceApiKeySecretEncrypted &&
            account.voiceTwimlAppSid,
        ),
        numbers: (account.phoneNumbers ?? [])
          .filter((line) => line.phoneNumber)
          .map((line) => ({
            phoneNumber: line.phoneNumber,
            label: line.label || line.twilioFriendlyName || line.phoneNumber,
            voice: Boolean(line.voice),
          })),
      })),
      emailAccounts: email.map((account) => ({
        id: String(account._id),
        friendlyName: account.friendlyName,
        fromEmail: account.fromEmail,
        fromName: account.fromName,
      })),
    });
  } catch (err) {
    console.error("GET /inboxes/channels error:", err);
    res.status(500).json({ message: "Failed to load channels" });
  }
}

export async function listInboxTemplates(req: AuthRequest, res: Response): Promise<void> {
  try {
    const type = req.query.type === "email" ? "email" : req.query.type === "sms" ? "sms" : "";
    const rows = await MessageTemplate.find({
      deletedAt: null,
      ...(type ? { templateType: type } : {}),
    })
      .select("name templateType subject body")
      .sort({ name: 1 })
      .lean();
    res.json({
      templates: rows.map((row) => ({
        id: String(row._id),
        name: row.name,
        type: row.templateType,
        subject: row.subject || "",
        body: row.body || "",
      })),
    });
  } catch (err) {
    console.error("GET /inboxes/templates error:", err);
    res.status(500).json({ message: "Failed to load templates" });
  }
}

export async function rateCallTranscript(req: AuthRequest, res: Response): Promise<void> {
  const rating = parseTranscriptRating({
    stars: req.body?.stars,
    comment: req.body?.comment,
  });
  if (!rating) {
    res.status(400).json({ message: "Choose a rating from 1 to 5." });
    return;
  }
  if (!Types.ObjectId.isValid(String(req.params.communicationId || ""))) {
    res.status(404).json({ message: "Call not found" });
    return;
  }
  const doc = await TwilioCommunication.findOne({
    _id: req.params.communicationId,
    channel: "voice",
  });
  if (!doc) {
    res.status(404).json({ message: "Call not found" });
    return;
  }
  doc.transcriptRating = {
    stars: rating.stars,
    comment: rating.comment,
    ratedByUserRef: req.user?.id ? new Types.ObjectId(req.user.id) : null,
    ratedAt: new Date(),
  };
  await doc.save();
  res.json({
    rating: { stars: rating.stars, comment: rating.comment },
  });
}

export async function dismissCallTaskPrompt(req: AuthRequest, res: Response): Promise<void> {
  if (!Types.ObjectId.isValid(String(req.params.communicationId || ""))) {
    res.status(404).json({ message: "Call not found" });
    return;
  }
  const doc = await TwilioCommunication.findOneAndUpdate(
    { _id: req.params.communicationId, channel: "voice" },
    { $set: { taskPromptDismissedAt: new Date() } },
    { new: true },
  );
  if (!doc) {
    res.status(404).json({ message: "Call not found" });
    return;
  }
  res.json({ dismissed: true });
}

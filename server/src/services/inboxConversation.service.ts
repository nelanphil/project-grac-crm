import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import {
  InboxChannel,
  InboxConversation,
  InboxDirection,
  InboxHandleKind,
  IInboxConversation,
} from "../models/mongo/InboxConversation";
import { publishDashboardChanged } from "./dashboardLive";
import { customerDisplayName } from "./notification.service";
import {
  canonicalPhoneDigits,
  formatUsPhone,
  normalizePhoneDigits,
} from "../utils/customerSites";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";

const PREVIEW_LENGTH = 160;

export type InboxTouch = {
  customerRef?: Types.ObjectId | null;
  handle: string;
  handleKind: InboxHandleKind;
  at: Date;
  preview: string;
  channel: InboxChannel;
  direction: InboxDirection;
  ourNumber?: string;
  emailAccountRef?: Types.ObjectId | null;
  countUnread?: boolean;
  publish?: boolean;
  /** Reopen a closed conversation when a newer inbound message arrives. */
  reopen?: boolean;
  actorUserId?: string | null;
  displayName?: string;
};

export function inboxPhoneHandle(raw: string | null | undefined): string {
  return canonicalPhoneDigits(raw) || normalizePhoneDigits(raw);
}

export function inboxEmailHandle(raw: string | null | undefined): string {
  return normalizeAccountEmail(raw || "");
}

export function inboxPreview(input: {
  channel: InboxChannel;
  body?: string | null;
  subject?: string | null;
}): string {
  if (input.channel === "email") {
    const subject = (input.subject || "").replace(/\s+/g, " ").trim();
    if (subject && subject !== "(no subject)") return subject.slice(0, PREVIEW_LENGTH);
  }
  const text = (input.body || "").replace(/\s+/g, " ").trim();
  if (input.channel === "voice") {
    if (text && text !== "Voice message") return text.slice(0, PREVIEW_LENGTH);
    return "";
  }
  if (!text && input.channel === "mms") return "Photo";
  return text.slice(0, PREVIEW_LENGTH);
}

function isDuplicateKey(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && (err as { code?: number }).code === 11000,
  );
}

function asObjectId(value: unknown): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  const raw = String(value);
  return Types.ObjectId.isValid(raw) ? new Types.ObjectId(raw) : null;
}

async function labelForCustomer(
  customerRef: Types.ObjectId | null,
): Promise<string> {
  if (!customerRef) return "";
  const customer = await Customer.findById(customerRef)
    .select("accountName first last")
    .lean();
  return customer ? customerDisplayName(customer) : "";
}

function conversationFilter(input: {
  customerRef?: Types.ObjectId | null;
  handle: string;
  handleKind: InboxHandleKind;
}): Record<string, unknown> {
  if (input.customerRef) return { customerRef: input.customerRef };
  return {
    customerRef: null,
    handle: input.handle,
    handleKind: input.handleKind,
  };
}

export async function touchInboxConversation(
  input: InboxTouch,
): Promise<IInboxConversation | null> {
  const handle =
    input.handleKind === "email"
      ? inboxEmailHandle(input.handle)
      : inboxPhoneHandle(input.handle);
  if (!handle && !input.customerRef) return null;

  const customerRef = asObjectId(input.customerRef);
  const named =
    input.displayName?.trim() ||
    (await labelForCustomer(customerRef)) ||
    (input.handleKind === "phone" ? formatUsPhone(handle) : handle);
  const filter = conversationFilter({
    customerRef,
    handle,
    handleKind: input.handleKind,
  });
  const at = input.at instanceof Date ? input.at : new Date(input.at);
  const countUnread = Boolean(input.countUnread) && input.direction === "inbound";
  const reopen = input.reopen !== false;

  let convo = await InboxConversation.findOne(filter);
  if (!convo) {
    try {
      convo = await InboxConversation.create({
        customerRef,
        handle: handle || named,
        handleKind: input.handleKind,
        displayName: named,
        lastMessageAt: at,
        lastPreview: input.preview,
        lastChannel: input.channel,
        lastDirection: input.direction,
        unreadCount: countUnread ? 1 : 0,
        readAt: input.direction === "outbound" ? at : null,
        readByUserRef:
          input.direction === "outbound" && input.actorUserId
            ? asObjectId(input.actorUserId)
            : null,
        status: "open",
        ourNumber: input.ourNumber || "",
        emailAccountRef: input.emailAccountRef ?? null,
      });
      if (input.publish !== false) publishDashboardChanged();
      return convo;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      convo = await InboxConversation.findOne(filter);
      if (!convo) throw err;
    }
  }

  const previous = convo.lastMessageAt
    ? new Date(convo.lastMessageAt).getTime()
    : null;
  const newer = previous == null || at.getTime() >= previous;
  if (newer) {
    convo.lastMessageAt = at;
    convo.lastPreview = input.preview;
    convo.lastChannel = input.channel;
    convo.lastDirection = input.direction;
    if (input.ourNumber) convo.ourNumber = input.ourNumber;
    if (input.emailAccountRef) convo.emailAccountRef = input.emailAccountRef;
  }
  if (named && (customerRef || !convo.displayName)) convo.displayName = named;
  if (customerRef) convo.customerRef = customerRef;

  if (countUnread) {
    convo.unreadCount = (convo.unreadCount || 0) + 1;
    convo.readAt = null;
    convo.readByUserRef = null;
    if (reopen) {
      convo.status = "open";
      convo.closedAt = null;
      convo.closedByUserRef = null;
    }
  } else if (input.direction === "outbound" && newer) {
    convo.unreadCount = 0;
    if (!convo.readAt) {
      convo.readAt = at;
      const actor = asObjectId(input.actorUserId);
      if (actor) convo.readByUserRef = actor;
    }
  } else if (input.direction === "inbound" && newer && reopen && convo.status === "closed") {
    convo.status = "open";
    convo.closedAt = null;
    convo.closedByUserRef = null;
  }

  await convo.save();
  if (input.publish !== false) publishDashboardChanged();
  return convo;
}

type TwilioTouchSource = {
  customerRef?: Types.ObjectId | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  direction?: string | null;
  channel?: string | null;
  body?: string | null;
  createdAt?: Date | null;
  status?: string | null;
};

export async function touchFromTwilio(
  doc: TwilioTouchSource,
  opts?: { countUnread?: boolean; publish?: boolean; reopen?: boolean; actorUserId?: string | null },
): Promise<void> {
  try {
    const direction = doc.direction === "outbound" ? "outbound" : "inbound";
    const channel: InboxChannel =
      doc.channel === "mms" || doc.channel === "voice" ? doc.channel : "sms";
    const body = doc.body || "";
    if (!body.trim() && channel !== "voice" && direction === "outbound") return;
    const theirNumber = direction === "inbound" ? doc.fromNumber : doc.toNumber;
    const ourNumber = direction === "inbound" ? doc.toNumber : doc.fromNumber;
    const handle = inboxPhoneHandle(theirNumber);
    const customerRef = asObjectId(doc.customerRef);
    if (!handle && !customerRef) return;
    await touchInboxConversation({
      customerRef,
      handle,
      handleKind: "phone",
      at: doc.createdAt ? new Date(doc.createdAt) : new Date(),
      preview: inboxPreview({ channel, body }),
      channel,
      direction,
      ourNumber: ourNumber || "",
      countUnread: opts?.countUnread ?? direction === "inbound",
      publish: opts?.publish,
      reopen: opts?.reopen,
      actorUserId: opts?.actorUserId,
    });
  } catch (err) {
    console.error("[inboxes] twilio touch failed:", err);
  }
}

type EmailTouchSource = {
  customerRef?: Types.ObjectId | null;
  fromEmail?: string | null;
  toEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  body?: string | null;
  direction?: string | null;
  createdAt?: Date | null;
  receivedAt?: Date | null;
  emailAccountRef?: Types.ObjectId | null;
};

export async function touchFromEmail(
  doc: EmailTouchSource,
  opts?: { countUnread?: boolean; publish?: boolean; reopen?: boolean; actorUserId?: string | null },
): Promise<void> {
  try {
    const direction = doc.direction === "inbound" ? "inbound" : "outbound";
    const theirEmail = direction === "inbound" ? doc.fromEmail : doc.toEmail;
    const handle = inboxEmailHandle(theirEmail);
    const customerRef = asObjectId(doc.customerRef);
    if (!handle && !customerRef) return;
    const at = doc.receivedAt
      ? new Date(doc.receivedAt)
      : doc.createdAt
        ? new Date(doc.createdAt)
        : new Date();
    await touchInboxConversation({
      customerRef,
      handle,
      handleKind: "email",
      at,
      preview: inboxPreview({
        channel: "email",
        body: doc.body,
        subject: doc.subject,
      }),
      channel: "email",
      direction,
      emailAccountRef: asObjectId(doc.emailAccountRef),
      countUnread: opts?.countUnread ?? direction === "inbound",
      publish: opts?.publish,
      reopen: opts?.reopen,
      actorUserId: opts?.actorUserId,
      displayName: direction === "inbound" ? doc.fromName || "" : "",
    });
  } catch (err) {
    console.error("[inboxes] email touch failed:", err);
  }
}

type RebuildDraft = {
  customerRef: Types.ObjectId | null;
  handle: string;
  handleKind: InboxHandleKind;
  lastMessageAt: Date;
  lastPreview: string;
  lastChannel: InboxChannel;
  lastDirection: InboxDirection;
  ourNumber: string;
  emailAccountRef: Types.ObjectId | null;
};

function consider(
  map: Map<string, RebuildDraft>,
  draft: RebuildDraft,
): void {
  const key = draft.customerRef
    ? `c:${String(draft.customerRef)}`
    : `${draft.handleKind}:${draft.handle}`;
  const current = map.get(key);
  if (!current || draft.lastMessageAt.getTime() >= current.lastMessageAt.getTime()) {
    map.set(key, draft);
  }
}

/**
 * Build one conversation per customer (or unknown handle) from stored
 * messages. Reruns refresh the latest preview. Unread is set only when the
 * latest message is inbound and nobody has read past it.
 */
export async function rebuildInboxConversations(): Promise<{
  conversations: number;
  messages: number;
}> {
  const map = new Map<string, RebuildDraft>();
  let messages = 0;

  const twilio = TwilioCommunication.find()
    .select("customerRef fromNumber toNumber direction channel body createdAt")
    .lean()
    .cursor();
  for await (const doc of twilio) {
    messages += 1;
    const direction = doc.direction === "outbound" ? "outbound" : "inbound";
    const channel: InboxChannel =
      doc.channel === "mms" || doc.channel === "voice" ? doc.channel : "sms";
    if (!(doc.body || "").trim() && channel !== "voice" && direction === "outbound") {
      continue;
    }
    const theirNumber = direction === "inbound" ? doc.fromNumber : doc.toNumber;
    const handle = inboxPhoneHandle(theirNumber);
    const customerRef = asObjectId(doc.customerRef);
    if (!handle && !customerRef) continue;
    consider(map, {
      customerRef,
      handle: handle || "unknown",
      handleKind: "phone",
      lastMessageAt: doc.createdAt ? new Date(doc.createdAt) : new Date(0),
      lastPreview: inboxPreview({ channel, body: doc.body }),
      lastChannel: channel,
      lastDirection: direction,
      ourNumber: (direction === "inbound" ? doc.toNumber : doc.fromNumber) || "",
      emailAccountRef: null,
    });
  }

  const emails = EmailCommunication.find()
    .select(
      "customerRef fromEmail toEmail fromName subject body direction createdAt receivedAt emailAccountRef status",
    )
    .lean()
    .cursor();
  for await (const doc of emails) {
    messages += 1;
    if (doc.status === "failed") continue;
    const direction = doc.direction === "inbound" ? "inbound" : "outbound";
    const theirEmail = direction === "inbound" ? doc.fromEmail : doc.toEmail;
    const handle = inboxEmailHandle(theirEmail);
    const customerRef = asObjectId(doc.customerRef);
    if (!handle && !customerRef) continue;
    const at = doc.receivedAt
      ? new Date(doc.receivedAt)
      : doc.createdAt
        ? new Date(doc.createdAt)
        : new Date(0);
    consider(map, {
      customerRef,
      handle: handle || "unknown",
      handleKind: "email",
      lastMessageAt: at,
      lastPreview: inboxPreview({
        channel: "email",
        body: doc.body,
        subject: doc.subject,
      }),
      lastChannel: "email",
      lastDirection: direction,
      ourNumber: "",
      emailAccountRef: asObjectId(doc.emailAccountRef),
    });
  }

  const customerIds = [
    ...new Set(
      [...map.values()]
        .map((draft) => (draft.customerRef ? String(draft.customerRef) : ""))
        .filter(Boolean),
    ),
  ];
  const customers = customerIds.length
    ? await Customer.find({ _id: { $in: customerIds } })
        .select("accountName first last")
        .lean()
    : [];
  const names = new Map(
    customers.map((row) => [String(row._id), customerDisplayName(row)]),
  );

  const ops = [...map.values()].map((draft) => {
    const displayName = draft.customerRef
      ? names.get(String(draft.customerRef)) ||
        (draft.handleKind === "phone" ? formatUsPhone(draft.handle) : draft.handle)
      : draft.handleKind === "phone"
        ? formatUsPhone(draft.handle)
        : draft.handle;
    const filter = draft.customerRef
      ? { customerRef: draft.customerRef }
      : { customerRef: null, handle: draft.handle, handleKind: draft.handleKind };
    const $set: {
      displayName: string;
      lastMessageAt: Date;
      lastPreview: string;
      lastChannel: InboxChannel;
      lastDirection: InboxDirection;
      ourNumber: string;
      emailAccountRef: Types.ObjectId | null;
      handle?: string;
      handleKind?: InboxHandleKind;
    } = {
      displayName,
      lastMessageAt: draft.lastMessageAt,
      lastPreview: draft.lastPreview,
      lastChannel: draft.lastChannel,
      lastDirection: draft.lastDirection,
      ourNumber: draft.ourNumber,
      emailAccountRef: draft.emailAccountRef,
    };
    if (draft.customerRef) {
      $set.handle = draft.handle;
      $set.handleKind = draft.handleKind;
    }
    return {
      updateOne: {
        filter,
        update: {
          $set,
          $setOnInsert: {
            status: "open" as const,
            unreadCount: 0,
            readAt: null,
          },
        },
        upsert: true,
      },
    };
  });

  if (ops.length > 0) {
    for (let i = 0; i < ops.length; i += 500) {
      await InboxConversation.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }

  await InboxConversation.updateMany(
    {
      lastDirection: "inbound",
      $or: [
        { readAt: null },
        { $expr: { $gt: ["$lastMessageAt", "$readAt"] } },
      ],
    },
    { $set: { unreadCount: 1, status: "open", closedAt: null } },
  );
  await InboxConversation.updateMany(
    { lastDirection: "outbound" },
    { $set: { unreadCount: 0 } },
  );

  return { conversations: ops.length, messages };
}

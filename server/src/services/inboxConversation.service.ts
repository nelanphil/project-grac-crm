import { Types } from "mongoose";
import { Customer, activeCustomerFilter } from "../models/mongo/Customer";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { InboxBlock } from "../models/mongo/InboxBlock";
import {
  InboxChannel,
  InboxConversation,
  InboxDirection,
  InboxHandleKind,
  IInboxConversation,
} from "../models/mongo/InboxConversation";
import { Task } from "../models/mongo/Task";
import { publishDashboardChanged } from "./dashboardLive";
import { customerDisplayName } from "./notification.service";
import {
  canonicalPhoneDigits,
  formatUsPhone,
  normalizePhoneDigits,
} from "../utils/customerSites";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";
import { phoneLinesMatch } from "../utils/twilioPhoneLines";
import { resolveInboxCustomer } from "./inboxCustomerResolve.service";

const notMerged = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

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

export type InboxLifecycle = {
  status: "open" | "closed";
  unreadCount: number;
  readAt: Date | null;
  deletedAt: Date | null;
  historyFrom: Date | null;
  blocked: boolean;
};

/**
 * Next inbox flags after a message. A blocked chat stays quiet. A deleted
 * chat comes back on a newer message and hides history from before the delete.
 * Staff replies reopen a chat that was marked done, unless this is a backfill.
 */
export function nextInboxLifecycle(
  state: InboxLifecycle,
  input: {
    direction: InboxDirection;
    at: Date;
    newer: boolean;
    countUnread: boolean;
    reopen: boolean;
  },
): InboxLifecycle {
  if (state.blocked) return { ...state };
  const next: InboxLifecycle = { ...state };

  if (input.newer && input.reopen && state.deletedAt) {
    next.historyFrom = state.deletedAt;
    next.deletedAt = null;
    next.status = "open";
  }

  if (input.countUnread) {
    next.unreadCount = (state.unreadCount || 0) + 1;
    next.readAt = null;
    if (input.reopen) next.status = "open";
    return next;
  }

  if (input.direction === "outbound" && input.newer) {
    next.unreadCount = 0;
    if (!state.readAt) next.readAt = input.at;
    if (input.reopen && (state.status === "closed" || state.deletedAt)) {
      next.status = "open";
    }
    return next;
  }

  if (
    input.direction === "inbound" &&
    input.newer &&
    input.reopen &&
    state.status === "closed"
  ) {
    next.status = "open";
  }

  return next;
}

export async function isInboxHandleBlocked(
  handle: string,
  handleKind: InboxHandleKind,
): Promise<boolean> {
  if (!handle) return false;
  const hit = await InboxBlock.exists({ handle, handleKind });
  return Boolean(hit);
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
  const customerLabel = await labelForCustomer(customerRef);
  const named =
    customerLabel ||
    input.displayName?.trim() ||
    (input.handleKind === "phone" ? formatUsPhone(handle) : handle);
  const filter = conversationFilter({
    customerRef,
    handle,
    handleKind: input.handleKind,
  });
  const at = input.at instanceof Date ? input.at : new Date(input.at);
  const countUnread = Boolean(input.countUnread) && input.direction === "inbound";
  const reopen = input.reopen !== false;
  const listedBlocked = handle
    ? await isInboxHandleBlocked(handle, input.handleKind)
    : false;

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
        unreadCount: listedBlocked || !countUnread ? 0 : 1,
        readAt: input.direction === "outbound" ? at : null,
        readByUserRef:
          input.direction === "outbound" && input.actorUserId
            ? asObjectId(input.actorUserId)
            : null,
        status: "open",
        blocked: listedBlocked,
        ourNumber: input.ourNumber || "",
        emailAccountRef: input.emailAccountRef ?? null,
      });
      if (!listedBlocked && input.publish !== false) publishDashboardChanged();
      return convo;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      convo = await InboxConversation.findOne(filter);
      if (!convo) throw err;
    }
  }

  if (listedBlocked) convo.blocked = true;
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
  if (customerRef) {
    convo.customerRef = customerRef;
    if (customerLabel) convo.displayName = customerLabel;
  } else if (named && !convo.displayName) {
    convo.displayName = named;
  }

  const hadReadAt = Boolean(convo.readAt);
  const wasClosed = convo.status === "closed" || Boolean(convo.deletedAt);
  const next = nextInboxLifecycle(
    {
      status: convo.status,
      unreadCount: convo.unreadCount || 0,
      readAt: convo.readAt ?? null,
      deletedAt: convo.deletedAt ?? null,
      historyFrom: convo.historyFrom ?? null,
      blocked: Boolean(convo.blocked),
    },
    {
      direction: input.direction,
      at,
      newer,
      countUnread,
      reopen,
    },
  );
  convo.status = next.status;
  convo.unreadCount = next.unreadCount;
  convo.deletedAt = next.deletedAt;
  convo.historyFrom = next.historyFrom;
  if (!next.readAt) {
    convo.readAt = null;
    convo.readByUserRef = null;
  } else if (!hadReadAt) {
    convo.readAt = next.readAt;
    const actor = asObjectId(input.actorUserId);
    if (actor) convo.readByUserRef = actor;
  }
  if (next.status === "open" && wasClosed) {
    convo.closedAt = null;
    convo.closedByUserRef = null;
  }

  await convo.save();
  if (!convo.blocked && input.publish !== false) publishDashboardChanged();
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
): Promise<IInboxConversation | null> {
  try {
    const direction = doc.direction === "inbound" ? "inbound" : "outbound";
    const theirEmail = direction === "inbound" ? doc.fromEmail : doc.toEmail;
    const handle = inboxEmailHandle(theirEmail);
    const customerRef = asObjectId(doc.customerRef);
    if (!handle && !customerRef) return null;
    const at = doc.receivedAt
      ? new Date(doc.receivedAt)
      : doc.createdAt
        ? new Date(doc.createdAt)
        : new Date();
    return await touchInboxConversation({
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
    return null;
  }
}

async function blockHandles(
  convo: IInboxConversation,
): Promise<{ handle: string; handleKind: InboxHandleKind }[]> {
  const found = new Map<string, { handle: string; handleKind: InboxHandleKind }>();
  const add = (raw: string | null | undefined, kind: InboxHandleKind) => {
    const handle = kind === "email" ? inboxEmailHandle(raw) : inboxPhoneHandle(raw || "");
    if (!handle) return;
    found.set(`${kind}:${handle}`, { handle, handleKind: kind });
  };
  add(convo.handle, convo.handleKind);
  if (!convo.customerRef) return [...found.values()];
  const customer = await Customer.findById(convo.customerRef).select("phone email").lean();
  if (customer) {
    add(customer.phone, "phone");
    add(customer.email, "email");
  }
  const contacts = await CustomerContact.find({
    customerRef: convo.customerRef,
    ...activeContactFilter,
  })
    .select("phone email")
    .lean();
  for (const contact of contacts) {
    add(contact.phone, "phone");
    add(contact.email, "email");
  }
  return [...found.values()];
}

/** Block or unblock every phone and email this conversation can be reached on. */
export async function setInboxBlocked(
  convo: IInboxConversation,
  blocked: boolean,
  userId: string | null,
): Promise<void> {
  const handles = await blockHandles(convo);
  if (blocked && handles.length > 0) {
    await InboxBlock.bulkWrite(
      handles.map((row) => ({
        updateOne: {
          filter: { handle: row.handle, handleKind: row.handleKind },
          update: {
            $setOnInsert: {
              handle: row.handle,
              handleKind: row.handleKind,
              blockedByUserRef: asObjectId(userId),
            },
          },
          upsert: true,
        },
      })),
    );
  } else if (!blocked && handles.length > 0) {
    await InboxBlock.deleteMany({ $or: handles });
  }
  await InboxConversation.updateMany(
    {
      $or: [
        { _id: convo._id },
        ...handles.map((row) => ({ handle: row.handle, handleKind: row.handleKind })),
      ],
    },
    { $set: { blocked } },
  );
}

/** Attach an unknown conversation to a customer and fold it into that customer's thread. */
export async function linkInboxConversationToCustomer(
  convo: IInboxConversation,
  customerId: Types.ObjectId,
): Promise<IInboxConversation> {
  const customer = await Customer.findOne({
    _id: customerId,
    ...activeCustomerFilter,
    ...notMerged,
  })
    .select("accountName first last")
    .lean();
  if (!customer) return convo;

  await Task.updateMany(
    { inboxConversationRef: convo._id },
    { $set: { customerRef: customer._id } },
  );

  const contacts = await CustomerContact.find({
    customerRef: customer._id,
    ...activeContactFilter,
  })
    .select("phone email")
    .lean();
  const contact = contacts.find((row) =>
    convo.handleKind === "phone"
      ? phoneLinesMatch(row.phone || "", convo.handle)
      : normalizeAccountEmail(row.email || "") === normalizeAccountEmail(convo.handle),
  );
  const contactRef = contact?._id ?? null;

  if (convo.handleKind === "email") {
    const handle = inboxEmailHandle(convo.handle);
    if (handle) {
      await EmailCommunication.updateMany(
        { customerRef: null, $or: [{ fromEmail: handle }, { toEmail: handle }] },
        { $set: { customerRef: customer._id, contactRef } },
      );
    }
  } else {
    const handle = inboxPhoneHandle(convo.handle);
    if (handle) {
      const pattern = new RegExp(`${handle}$`);
      await TwilioCommunication.updateMany(
        {
          customerRef: null,
          $or: [{ fromNumber: pattern }, { toNumber: pattern }],
        },
        { $set: { customerRef: customer._id, contactRef } },
      );
    }
  }

  const existing = await InboxConversation.findOne({
    customerRef: customer._id,
    _id: { $ne: convo._id },
  });
  if (existing) {
    const sourceAt = convo.lastMessageAt ? new Date(convo.lastMessageAt).getTime() : 0;
    const targetAt = existing.lastMessageAt ? new Date(existing.lastMessageAt).getTime() : 0;
    if (sourceAt >= targetAt) {
      existing.lastMessageAt = convo.lastMessageAt;
      existing.lastPreview = convo.lastPreview;
      if (convo.lastChannel) existing.lastChannel = convo.lastChannel;
      if (convo.lastDirection) existing.lastDirection = convo.lastDirection;
      existing.ourNumber = convo.ourNumber || existing.ourNumber;
      existing.emailAccountRef = convo.emailAccountRef || existing.emailAccountRef;
      existing.handle = convo.handle;
      existing.handleKind = convo.handleKind;
    }
    existing.unreadCount = (existing.unreadCount || 0) + (convo.unreadCount || 0);
    existing.displayName = customerDisplayName(customer);
    if (convo.lastDirection === "inbound" && sourceAt >= targetAt) {
      existing.status = "open";
    }
    await Task.updateMany(
      { inboxConversationRef: convo._id },
      { $set: { customerRef: customer._id, inboxConversationRef: existing._id } },
    );
    await existing.save();
    await convo.deleteOne();
    return existing;
  }

  convo.customerRef = customer._id;
  convo.displayName = customerDisplayName(customer);
  await convo.save();
  return convo;
}

/** Link an unknown conversation when the handle matches one customer. */
export async function ensureInboxCustomer(
  convo: IInboxConversation,
): Promise<IInboxConversation> {
  if (convo.customerRef) return convo;
  const customerId = await resolveInboxCustomer({
    handle: convo.handle,
    handleKind: convo.handleKind,
    fromName: convo.displayName,
  });
  if (!customerId) return convo;
  return linkInboxConversationToCustomer(convo, customerId);
}

async function claimUnresolvedMessages(): Promise<void> {
  const cache = new Map<string, Types.ObjectId | null>();
  async function customerFor(
    handle: string,
    handleKind: InboxHandleKind,
    fromName?: string,
  ): Promise<Types.ObjectId | null> {
    const key = `${handleKind}:${handle}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const customerId = await resolveInboxCustomer({ handle, handleKind, fromName });
    cache.set(key, customerId);
    return customerId;
  }

  const emails = EmailCommunication.find({
    customerRef: null,
    direction: "inbound",
  })
    .select("fromEmail fromName")
    .cursor();
  for await (const doc of emails) {
    const handle = inboxEmailHandle(doc.fromEmail);
    if (!handle) continue;
    const customerId = await customerFor(handle, "email", doc.fromName || "");
    if (!customerId) continue;
    await EmailCommunication.updateOne(
      { _id: doc._id, customerRef: null },
      { $set: { customerRef: customerId } },
    );
  }

  const texts = TwilioCommunication.find({ customerRef: null })
    .select("fromNumber toNumber direction")
    .cursor();
  for await (const doc of texts) {
    const direction = doc.direction === "outbound" ? "outbound" : "inbound";
    const raw = direction === "inbound" ? doc.fromNumber : doc.toNumber;
    const handle = inboxPhoneHandle(raw);
    if (!handle) continue;
    const customerId = await customerFor(handle, "phone");
    if (!customerId) continue;
    await TwilioCommunication.updateOne(
      { _id: doc._id, customerRef: null },
      { $set: { customerRef: customerId } },
    );
  }
}

async function dropResolvedUnknowns(): Promise<void> {
  const unknowns = await InboxConversation.find({ customerRef: null });
  for (const convo of unknowns) {
    const customerId = await resolveInboxCustomer({
      handle: convo.handle,
      handleKind: convo.handleKind,
      fromName: convo.displayName,
    });
    if (!customerId) continue;
    const survivor = await InboxConversation.findOne({ customerRef: customerId });
    if (survivor) await convo.deleteOne();
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
  await claimUnresolvedMessages();
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

  // Refresh unread only. Leave deletedAt, historyFrom, blocked, and pins alone.
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
  await dropResolvedUnknowns();

  return { conversations: ops.length, messages };
}

import { Types } from "mongoose";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  CommunicationChannel,
  CommunicationDirection,
  TwilioCommunication,
} from "../models/mongo/TwilioCommunication";
import { IMessageThread, MessageThread } from "../models/mongo/MessageThread";
import { toE164 } from "./messagingContext";
import { voiceConversationPreview } from "./voiceActivity";

const PREVIEW_LENGTH = 160;

export class ThreadNotFoundError extends Error {
  constructor() {
    super("Thread not found");
    this.name = "ThreadNotFoundError";
  }
}

export class ThreadConflictError extends Error {
  constructor() {
    super("Could not reopen thread due to a concurrent update — try again");
    this.name = "ThreadConflictError";
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  );
}

function hasContactRef(
  ref: Types.ObjectId | null | undefined,
): ref is Types.ObjectId {
  return Boolean(ref);
}

/** Canonical phone stored on contactPhoneSnapshot for unknown-thread reuse. */
export function normalizeThreadPhone(phone: string | null | undefined): string {
  const raw = (phone ?? "").trim();
  if (!raw) return "";
  return toE164(raw) ?? raw;
}

function previewText(body: string, transcript?: string): string {
  return (body || transcript || "").slice(0, PREVIEW_LENGTH);
}

async function stampCustomerRefIfMissing(
  thread: IMessageThread,
  customerRef: Types.ObjectId | null,
): Promise<IMessageThread> {
  if (!customerRef || thread.customerRef) return thread;
  thread.customerRef = customerRef;
  await thread.save();
  return thread;
}

type ResolveOutboundParams = {
  contactRef: Types.ObjectId;
  customerRef: Types.ObjectId | null;
  twilioAccountRef: Types.ObjectId;
  accountSid: string;
  ourNumber: string;
  userId: string | null;
};

/**
 * Reuses the open thread for (contactRef, ourNumber) if one exists, else creates it.
 * Race-safe via the partial-unique index on {contactRef, ourNumber} where
 * status is open and contactRef is an ObjectId.
 */
export async function resolveOrCreateOpenThreadForOutbound(
  params: ResolveOutboundParams,
): Promise<IMessageThread> {
  const existing = await MessageThread.findOne({
    contactRef: params.contactRef,
    ourNumber: params.ourNumber,
    status: "open",
  });
  if (existing) {
    return stampCustomerRefIfMissing(existing, params.customerRef);
  }

  const contact = await CustomerContact.findById(params.contactRef)
    .select("phone")
    .lean();

  try {
    return await MessageThread.create({
      contactRef: params.contactRef,
      customerRef: params.customerRef,
      twilioAccountRef: params.twilioAccountRef,
      accountSid: params.accountSid,
      ourNumber: params.ourNumber,
      contactPhoneSnapshot: normalizeThreadPhone(contact?.phone ?? ""),
      status: "open",
      startedByUserRef: params.userId
        ? new Types.ObjectId(params.userId)
        : null,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const reFetched = await MessageThread.findOne({
        contactRef: params.contactRef,
        ourNumber: params.ourNumber,
        status: "open",
      });
      if (reFetched) {
        return stampCustomerRefIfMissing(reFetched, params.customerRef);
      }
    }
    throw err;
  }
}

/**
 * Sends into a specific thread by id. If the thread is closed, reopens it and
 * closes any other thread currently open for the same identity:
 *   - known contact: (contactRef, ourNumber)
 *   - unknown: (ourNumber, contactPhoneSnapshot) with null contactRef
 */
export async function sendIntoThread(params: {
  threadId: string;
  userId: string | null;
}): Promise<IMessageThread> {
  if (!Types.ObjectId.isValid(params.threadId)) {
    throw new ThreadNotFoundError();
  }
  const thread = await MessageThread.findById(params.threadId);
  if (!thread) throw new ThreadNotFoundError();
  if (thread.status === "open") return thread;

  const closeSet = {
    status: "closed" as const,
    closedAt: new Date(),
    closedByUserRef: params.userId ? new Types.ObjectId(params.userId) : null,
  };

  if (hasContactRef(thread.contactRef)) {
    await MessageThread.updateMany(
      {
        contactRef: thread.contactRef,
        ourNumber: thread.ourNumber,
        status: "open",
        _id: { $ne: thread._id },
      },
      { $set: closeSet },
    );
  } else if (thread.contactPhoneSnapshot) {
    await MessageThread.updateMany(
      {
        contactRef: null,
        customerRef: null,
        ourNumber: thread.ourNumber,
        contactPhoneSnapshot: thread.contactPhoneSnapshot,
        status: "open",
        _id: { $ne: thread._id },
      },
      { $set: closeSet },
    );
  }

  try {
    const reopened = await MessageThread.findByIdAndUpdate(
      thread._id,
      { $set: { status: "open", closedAt: null, closedByUserRef: null } },
      { new: true },
    );
    if (!reopened) throw new ThreadNotFoundError();
    return reopened;
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new ThreadConflictError();
    throw err;
  }
}

type ResolveInboundParams = {
  contactRef: Types.ObjectId | null;
  customerRef: Types.ObjectId | null;
  twilioAccountRef: Types.ObjectId;
  accountSid: string;
  ourNumber: string;
  contactPhoneSnapshot?: string;
};

async function findOpenUnknownThread(
  ourNumber: string,
  contactPhoneSnapshot: string,
): Promise<IMessageThread | null> {
  if (!contactPhoneSnapshot) return null;
  return MessageThread.findOne({
    contactRef: null,
    customerRef: null,
    ourNumber,
    contactPhoneSnapshot,
    status: "open",
  });
}

async function createUnknownThread(params: {
  twilioAccountRef: Types.ObjectId;
  accountSid: string;
  ourNumber: string;
  contactPhoneSnapshot: string;
}): Promise<IMessageThread> {
  let created: IMessageThread;
  try {
    created = await MessageThread.create({
      contactRef: null,
      customerRef: null,
      twilioAccountRef: params.twilioAccountRef,
      accountSid: params.accountSid,
      ourNumber: params.ourNumber,
      contactPhoneSnapshot: params.contactPhoneSnapshot,
      status: "open",
      startedByUserRef: null,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const reFetched = await findOpenUnknownThread(
        params.ourNumber,
        params.contactPhoneSnapshot,
      );
      if (reFetched) return reFetched;
    }
    throw err;
  }

  // Race: two inbound unknown creates for the same phone. Keep the oldest
  // open thread and close extras (do not delete).
  const open = await MessageThread.find({
    contactRef: null,
    customerRef: null,
    ourNumber: params.ourNumber,
    contactPhoneSnapshot: params.contactPhoneSnapshot,
    status: "open",
  }).sort({ createdAt: 1, _id: 1 });

  if (open.length <= 1) return created;

  const winner = open[0];
  const loserIds = open.slice(1).map((t) => t._id);
  await TwilioCommunication.updateMany(
    { threadRef: { $in: loserIds } },
    { $set: { threadRef: winner._id } },
  );
  await MessageThread.updateMany(
    { _id: { $in: loserIds } },
    { $set: { status: "closed", closedAt: new Date(), closedByUserRef: null } },
  );
  return winner;
}

/**
 * Resolves the thread an inbound message/call belongs to.
 *
 * Known contact: open thread for (contactRef, ourNumber), else the most
 * recently touched thread for that pair (reopened), else a new thread.
 *
 * Unknown caller (no contactRef): reuse the open unattached thread for
 * (ourNumber, contactPhoneSnapshot); else reopen the most recent; else create
 * with customerRef and contactRef both null.
 */
export async function resolveThreadForInbound(
  params: ResolveInboundParams,
): Promise<IMessageThread> {
  const snapshot = normalizeThreadPhone(params.contactPhoneSnapshot ?? "");

  if (!hasContactRef(params.contactRef)) {
    const openUnknown = await findOpenUnknownThread(params.ourNumber, snapshot);
    if (openUnknown) return openUnknown;

    if (snapshot) {
      const mostRecentUnknown = await MessageThread.findOne({
        contactRef: null,
        customerRef: null,
        ourNumber: params.ourNumber,
        contactPhoneSnapshot: snapshot,
      }).sort({ lastMessageAt: -1, createdAt: -1 });

      if (mostRecentUnknown) {
        if (mostRecentUnknown.status !== "open") {
          await MessageThread.updateMany(
            {
              contactRef: null,
              customerRef: null,
              ourNumber: params.ourNumber,
              contactPhoneSnapshot: snapshot,
              status: "open",
              _id: { $ne: mostRecentUnknown._id },
            },
            {
              $set: {
                status: "closed",
                closedAt: new Date(),
                closedByUserRef: null,
              },
            },
          );
          mostRecentUnknown.status = "open";
          mostRecentUnknown.closedAt = null;
          mostRecentUnknown.closedByUserRef = null;
          await mostRecentUnknown.save();
        }
        return mostRecentUnknown;
      }
    }

    return createUnknownThread({
      twilioAccountRef: params.twilioAccountRef,
      accountSid: params.accountSid,
      ourNumber: params.ourNumber,
      contactPhoneSnapshot: snapshot,
    });
  }

  const open = await MessageThread.findOne({
    contactRef: params.contactRef,
    ourNumber: params.ourNumber,
    status: "open",
  });
  if (open) {
    return stampCustomerRefIfMissing(open, params.customerRef);
  }

  const mostRecent = await MessageThread.findOne({
    contactRef: params.contactRef,
    ourNumber: params.ourNumber,
  }).sort({ lastMessageAt: -1, createdAt: -1 });

  if (mostRecent) {
    mostRecent.status = "open";
    mostRecent.closedAt = null;
    mostRecent.closedByUserRef = null;
    if (params.customerRef && !mostRecent.customerRef) {
      mostRecent.customerRef = params.customerRef;
    }
    await mostRecent.save();
    return mostRecent;
  }

  const contact = await CustomerContact.findById(params.contactRef)
    .select("phone")
    .lean();

  try {
    return await MessageThread.create({
      contactRef: params.contactRef,
      customerRef: params.customerRef,
      twilioAccountRef: params.twilioAccountRef,
      accountSid: params.accountSid,
      ourNumber: params.ourNumber,
      contactPhoneSnapshot:
        snapshot || normalizeThreadPhone(contact?.phone ?? ""),
      status: "open",
      startedByUserRef: null,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const reFetched = await MessageThread.findOne({
        contactRef: params.contactRef,
        ourNumber: params.ourNumber,
        status: "open",
      });
      if (reFetched) {
        return stampCustomerRefIfMissing(reFetched, params.customerRef);
      }
    }
    throw err;
  }
}

export async function checkOpenThreadConflict(params: {
  contactRef: Types.ObjectId;
  ourNumber: string;
  excludeThreadId?: string;
}): Promise<{ hasOpenThread: boolean; openThread: IMessageThread | null }> {
  const filter: Record<string, unknown> = {
    contactRef: params.contactRef,
    ourNumber: params.ourNumber,
    status: "open",
  };
  if (params.excludeThreadId && Types.ObjectId.isValid(params.excludeThreadId)) {
    filter._id = { $ne: new Types.ObjectId(params.excludeThreadId) };
  }
  const openThread = await MessageThread.findOne(filter);
  return { hasOpenThread: Boolean(openThread), openThread };
}

export async function closeThread(params: {
  threadId: string;
  userId: string | null;
}): Promise<IMessageThread> {
  if (!Types.ObjectId.isValid(params.threadId)) {
    throw new ThreadNotFoundError();
  }
  const updated = await MessageThread.findOneAndUpdate(
    { _id: params.threadId, status: "open" },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        closedByUserRef: params.userId
          ? new Types.ObjectId(params.userId)
          : null,
      },
    },
    { new: true },
  );
  if (updated) return updated;

  const existing = await MessageThread.findById(params.threadId);
  if (!existing) throw new ThreadNotFoundError();
  return existing;
}

export async function touchThreadAfterMessage(
  threadRef: Types.ObjectId,
  info: {
    direction: CommunicationDirection;
    channel: CommunicationChannel;
    body: string;
    transcript?: string;
    at: Date;
  },
): Promise<void> {
  await MessageThread.updateOne(
    { _id: threadRef },
    {
      $set: {
        lastMessageAt: info.at,
        lastMessageDirection: info.direction,
        lastMessageChannel: info.channel,
        lastMessagePreview:
          info.channel === "voice" && info.direction === "inbound"
            ? voiceConversationPreview(info.transcript || info.body || "")
            : previewText(info.body, info.transcript),
      },
      $inc: { messageCount: 1 },
    },
  );
}

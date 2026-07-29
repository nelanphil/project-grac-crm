import { Types } from "mongoose";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  CommunicationChannel,
  CommunicationDirection,
} from "../models/mongo/TwilioCommunication";
import { IMessageThread, MessageThread } from "../models/mongo/MessageThread";

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
 * Race-safe via the partial-unique index on {contactRef, ourNumber, status:"open"}.
 */
export async function resolveOrCreateOpenThreadForOutbound(
  params: ResolveOutboundParams,
): Promise<IMessageThread> {
  const existing = await MessageThread.findOne({
    contactRef: params.contactRef,
    ourNumber: params.ourNumber,
    status: "open",
  });
  if (existing) return existing;

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
      contactPhoneSnapshot: contact?.phone ?? "",
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
      if (reFetched) return reFetched;
    }
    throw err;
  }
}

/**
 * Sends into a specific thread by id. If the thread is closed, reopens it and
 * closes any other thread currently open for the same (contactRef, ourNumber) pair.
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

  await MessageThread.updateMany(
    {
      contactRef: thread.contactRef,
      ourNumber: thread.ourNumber,
      status: "open",
      _id: { $ne: thread._id },
    },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        closedByUserRef: params.userId
          ? new Types.ObjectId(params.userId)
          : null,
      },
    },
  );

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
  contactRef: Types.ObjectId;
  customerRef: Types.ObjectId | null;
  twilioAccountRef: Types.ObjectId;
  accountSid: string;
  ourNumber: string;
};

/**
 * Resolves the thread an inbound message belongs to: the open thread for the
 * pair, else the most recently touched thread for the pair (reopened), else
 * a brand-new thread.
 */
export async function resolveThreadForInbound(
  params: ResolveInboundParams,
): Promise<IMessageThread> {
  const open = await MessageThread.findOne({
    contactRef: params.contactRef,
    ourNumber: params.ourNumber,
    status: "open",
  });
  if (open) return open;

  const mostRecent = await MessageThread.findOne({
    contactRef: params.contactRef,
    ourNumber: params.ourNumber,
  }).sort({ lastMessageAt: -1, createdAt: -1 });

  if (mostRecent) {
    mostRecent.status = "open";
    mostRecent.closedAt = null;
    mostRecent.closedByUserRef = null;
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
      contactPhoneSnapshot: contact?.phone ?? "",
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
      if (reFetched) return reFetched;
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
        lastMessagePreview: (info.body || "").slice(0, PREVIEW_LENGTH),
      },
      $inc: { messageCount: 1 },
    },
  );
}

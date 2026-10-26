import { Types } from "mongoose";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { MessageThread } from "../models/mongo/MessageThread";
import { ITwilioAccount } from "../models/mongo/TwilioAccount";
import {
  findContactByPhone,
  mapTwilioCallStatus,
} from "../utils/communicationFormat";
import {
  normalizeThreadPhone,
  resolveThreadForInbound,
  touchThreadAfterMessage,
} from "../utils/messageThreads";
import { toE164 } from "../utils/messagingContext";
import {
  recordCustomerActivity,
  recordCustomerActivityAsync,
} from "./customerActivity.service";
import type { RecordActivityInput } from "./customerActivity.service";
import { normalizePhoneDigits } from "../utils/customerSites";
import { touchFromTwilio } from "./inboxConversation.service";
import { listedPhoneNumbers } from "../utils/twilioPhoneLines";
import {
  formatVoicemailLine,
  mergeVoiceActivity,
  voiceConversationPreview,
} from "../utils/voiceActivity";

const OPT_OUT_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
];

const PREVIEW_LENGTH = 160;

export function isSmsOptOutKeyword(body: string): boolean {
  return OPT_OUT_KEYWORDS.includes(body.trim().toUpperCase());
}

function phonesMatch(a: string, b: string): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return (
    da.length >= 10 && db.length >= 10 && da.slice(-10) === db.slice(-10)
  );
}

function isOurNumber(account: ITwilioAccount, phone: string): boolean {
  return listedPhoneNumbers(account.phoneNumbers).some((n) =>
    phonesMatch(n, phone),
  );
}

export function voiceSidCandidates(
  params: Record<string, string>,
  extra?: string,
): string[] {
  return [
    ...new Set(
      [extra, params.CallSid, params.ParentCallSid]
        .map((sid) => (sid || "").trim())
        .filter(Boolean),
    ),
  ];
}

export async function findVoiceCommunication(
  accountSid: string,
  sids: string[],
) {
  if (sids.length === 0) return null;
  return TwilioCommunication.findOne({
    accountSid,
    channel: "voice",
    twilioSid: sids.length === 1 ? sids[0] : { $in: sids },
  });
}

export function withRecordingFirst(
  existing: string[],
  recordingUrl: string,
): string[] {
  if (!recordingUrl) return existing;
  const rest = existing.filter((u) => u !== recordingUrl);
  return [recordingUrl, ...rest];
}

export function inboundVoiceBody(transcript: string): string {
  return voiceConversationPreview(transcript);
}

export async function resolveInboundVoiceThread(params: {
  account: ITwilioAccount;
  fromNumber: string;
  toNumber: string;
  preferOutbound?: boolean;
}) {
  const outbound = params.preferOutbound
    ? Boolean(params.fromNumber && isOurNumber(params.account, params.fromNumber))
    : false;
  const direction = outbound ? "outbound" : "inbound";
  const ourNumberRaw = outbound ? params.fromNumber : params.toNumber;
  const theirNumber = outbound ? params.toNumber : params.fromNumber;
  const ourNumber = toE164(ourNumberRaw) ?? ourNumberRaw;
  const snapshot = normalizeThreadPhone(theirNumber);
  const matched = theirNumber ? await findContactByPhone(theirNumber) : null;
  // Unique open thread is (contactRef, ourNumber). customerRef is grouping only.
  const contactRef = matched?.contactRef ?? null;
  const customerRef = matched?.customerRef ?? null;

  const thread = await resolveThreadForInbound({
    contactRef,
    customerRef,
    twilioAccountRef: params.account._id,
    accountSid: params.account.accountSid,
    ourNumber,
    contactPhoneSnapshot: snapshot,
  });

  return {
    thread,
    direction: direction as "inbound" | "outbound",
    customerRef,
    contactRef,
  };
}

function timestampWrite(occurredAt?: Date): {
  set: Record<string, Date>;
  setOnInsert: Record<string, Date>;
  timestamps: boolean;
} {
  if (!occurredAt) {
    return { set: {}, setOnInsert: {}, timestamps: true };
  }
  return {
    set: { updatedAt: occurredAt },
    setOnInsert: { createdAt: occurredAt },
    timestamps: false,
  };
}

async function recordInboundActivity(
  input: RecordActivityInput,
  backfilled: boolean,
): Promise<void> {
  if (backfilled) {
    await recordCustomerActivity({ ...input, publish: false });
    return;
  }
  recordCustomerActivityAsync(input);
}

async function touchInboundThread(
  threadRef: Types.ObjectId,
  info: {
    direction: "inbound" | "outbound";
    channel: "sms" | "mms" | "voice";
    body: string;
    transcript?: string;
    at: Date;
  },
  onlyIfNewer: boolean,
): Promise<void> {
  if (!onlyIfNewer) {
    await touchThreadAfterMessage(threadRef, info);
    return;
  }

  const thread = await MessageThread.findById(threadRef)
    .select("lastMessageAt")
    .lean();
  const current = thread?.lastMessageAt
    ? new Date(thread.lastMessageAt).getTime()
    : null;
  if (current == null || info.at.getTime() >= current) {
    await touchThreadAfterMessage(threadRef, info);
    return;
  }

  await MessageThread.updateOne(
    { _id: threadRef },
    { $inc: { messageCount: 1 } },
  );
}

export type IngestInboundMessageResult = {
  communicationId: string | null;
  customerRef: Types.ObjectId | null;
  contactRef: Types.ObjectId | null;
  threadRef: Types.ObjectId | null;
  optOut: boolean;
  matched: boolean;
};

export async function ingestInboundMessage(opts: {
  account: ITwilioAccount;
  twilioSid: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  mediaUrls: string[];
  rawStatus?: string;
  occurredAt?: Date;
  backfilled?: boolean;
}): Promise<IngestInboundMessageResult> {
  const backfilled = Boolean(opts.backfilled);
  const fromNumber = opts.fromNumber || "";
  const toNumber = opts.toNumber || "";
  const body = opts.body || "";
  const mediaUrls = opts.mediaUrls ?? [];
  const channel = mediaUrls.length > 0 ? "mms" : "sms";
  const matched = fromNumber ? await findContactByPhone(fromNumber) : null;
  const ourNumber = toE164(toNumber) ?? toNumber;
  const snapshot = normalizeThreadPhone(fromNumber);
  const contactRef = matched?.contactRef ?? null;
  const customerRef = matched?.customerRef ?? null;
  const optOut = isSmsOptOutKeyword(body);

  const thread = await resolveThreadForInbound({
    contactRef,
    customerRef,
    twilioAccountRef: opts.account._id,
    accountSid: opts.account.accountSid,
    ourNumber,
    contactPhoneSnapshot: snapshot,
  });
  const threadRef = thread._id;
  const stamps = timestampWrite(opts.occurredAt);
  const prior = await TwilioCommunication.exists({
    accountSid: opts.account.accountSid,
    twilioSid: opts.twilioSid,
  });

  const doc = await TwilioCommunication.findOneAndUpdate(
    { accountSid: opts.account.accountSid, twilioSid: opts.twilioSid },
    {
      $set: {
        twilioAccountRef: opts.account._id,
        accountSid: opts.account.accountSid,
        channel,
        direction: "inbound",
        status: "received",
        fromNumber,
        toNumber,
        body,
        mediaUrls,
        customerRef,
        contactRef,
        threadRef,
        rawStatus: opts.rawStatus || "received",
        ...stamps.set,
      },
      $setOnInsert: {
        createdByUserRef: null,
        transcript: "",
        ...stamps.setOnInsert,
      },
    },
    { upsert: true, new: true, timestamps: stamps.timestamps },
  );

  await touchInboundThread(
    threadRef,
    {
      direction: "inbound",
      channel,
      body,
      at: opts.occurredAt ?? doc?.createdAt ?? new Date(),
    },
    Boolean(opts.occurredAt),
  );

  if (doc) {
    await touchFromTwilio(doc, {
      countUnread: !prior && !backfilled,
      publish: !backfilled,
      reopen: !backfilled,
    });
  }

  if (customerRef && doc) {
    const preview = body.trim().slice(0, 80);
    const activityBase = {
      customerRef,
      category: "communication" as const,
      actorKind: "customer" as const,
      actorName: "Customer",
      entityType: "twilio_communication",
      entityId: String(doc._id),
      source: backfilled ? ("backfill" as const) : ("webhook" as const),
      backfilled,
      metadata: { channel, fromNumber, threadId: String(threadRef) },
      ...(opts.occurredAt ? { createdAt: opts.occurredAt } : {}),
    };
    await recordInboundActivity(
      {
        ...activityBase,
        action: "received",
        summary: preview
          ? `Received a text: ${preview}`
          : "Received a text message",
        sourceEventId: `twilio:${opts.twilioSid}`,
      },
      backfilled,
    );
    if (optOut && !backfilled) {
      await recordInboundActivity(
        {
          ...activityBase,
          action: "opted_out",
          summary: "Opted out of text messages",
          sourceEventId: `twilio:${opts.twilioSid}:optout`,
          metadata: { threadId: String(threadRef) },
        },
        backfilled,
      );
    }
  }

  return {
    communicationId: doc ? String(doc._id) : null,
    customerRef,
    contactRef,
    threadRef,
    optOut,
    matched: Boolean(contactRef),
  };
}

export async function ingestInboundVoice(opts: {
  account: ITwilioAccount;
  callSid: string;
  parentCallSid?: string;
  fromNumber: string;
  toNumber: string;
  statusRaw?: string;
  defaultStatus: "in-progress" | "completed";
  transcript?: string;
  recordingUrl?: string;
  durationSeconds?: number | null;
  occurredAt?: Date;
  backfilled?: boolean;
}): Promise<void> {
  const backfilled = Boolean(opts.backfilled);
  const sidCandidates = voiceSidCandidates(
    {
      CallSid: opts.callSid,
      ParentCallSid: opts.parentCallSid || "",
    },
    opts.callSid,
  );
  const existing = await findVoiceCommunication(
    opts.account.accountSid,
    sidCandidates,
  );
  const canonicalSid =
    (existing?.twilioSid || "").trim() ||
    (opts.parentCallSid || "").trim() ||
    opts.callSid ||
    "";
  if (!canonicalSid) return;

  const fromNumber = opts.fromNumber || existing?.fromNumber || "";
  const toNumber = opts.toNumber || existing?.toNumber || "";
  const resolved = await resolveInboundVoiceThread({
    account: opts.account,
    fromNumber,
    toNumber,
  });

  let threadRef = resolved.thread._id;
  let customerRef = resolved.customerRef ?? existing?.customerRef ?? null;
  let contactRef = resolved.contactRef ?? existing?.contactRef ?? null;
  if (resolved.contactRef) {
    threadRef = resolved.thread._id;
    customerRef = resolved.customerRef;
    contactRef = resolved.contactRef;
  } else if (existing?.threadRef) {
    threadRef = existing.threadRef;
    customerRef = existing.customerRef ?? customerRef;
    contactRef = existing.contactRef ?? contactRef;
  }

  const incomingTranscript = (opts.transcript || "").trim();
  const mergedTranscript = incomingTranscript
    ? mergeVoiceActivity(
        existing?.transcript || "",
        formatVoicemailLine(incomingTranscript),
      )
    : (existing?.transcript || "").trim();
  const status = opts.statusRaw
    ? mapTwilioCallStatus(opts.statusRaw)
    : existing
      ? existing.status
      : opts.defaultStatus;
  const alreadyOnThread = Boolean(existing?.threadRef);
  const stamps = timestampWrite(opts.occurredAt);

  const $set: Record<string, unknown> = {
    twilioAccountRef: opts.account._id,
    accountSid: opts.account.accountSid,
    channel: "voice",
    direction: "inbound",
    status,
    fromNumber,
    toNumber,
    customerRef,
    contactRef,
    threadRef,
    rawStatus: opts.statusRaw || existing?.rawStatus || opts.defaultStatus,
    ...stamps.set,
  };

  if (incomingTranscript) {
    $set.transcript = mergedTranscript;
    $set.body = inboundVoiceBody(mergedTranscript);
  } else if (!existing) {
    $set.body = inboundVoiceBody("");
    $set.transcript = "";
  } else {
    $set.body = inboundVoiceBody(existing.transcript || "");
  }

  if (opts.recordingUrl) {
    $set.mediaUrls = withRecordingFirst(
      existing?.mediaUrls ?? [],
      opts.recordingUrl,
    );
  } else if (!existing) {
    $set.mediaUrls = [];
  }

  if (
    opts.durationSeconds != null &&
    Number.isFinite(opts.durationSeconds)
  ) {
    $set.durationSeconds = opts.durationSeconds;
  }

  const doc = await TwilioCommunication.findOneAndUpdate(
    { accountSid: opts.account.accountSid, twilioSid: canonicalSid },
    {
      $set,
      $setOnInsert: {
        createdByUserRef: null,
        twilioSid: canonicalSid,
        ...stamps.setOnInsert,
      },
    },
    { upsert: true, new: true, timestamps: stamps.timestamps },
  );

  if (doc) {
    await touchFromTwilio(
      {
        customerRef: doc.customerRef,
        fromNumber: doc.fromNumber,
        toNumber: doc.toNumber,
        direction: doc.direction,
        channel: doc.channel,
        body: typeof $set.body === "string" ? $set.body : doc.body,
        createdAt: doc.createdAt,
      },
      {
        countUnread: !existing && !backfilled,
        publish: !backfilled,
        reopen: !backfilled,
      },
    );
  }

  const preview =
    (typeof $set.body === "string" && $set.body) ||
    inboundVoiceBody(mergedTranscript);
  const activityAt = opts.occurredAt;

  if (customerRef && doc && !existing) {
    await recordInboundActivity(
      {
        customerRef,
        category: "communication",
        action: "called",
        summary: `Received a call from ${fromNumber || "an unknown number"}`,
        actorKind: "customer",
        actorName: "Customer",
        entityType: "twilio_communication",
        entityId: String(doc._id),
        source: backfilled ? "backfill" : "webhook",
        sourceEventId: `twilio:call:${canonicalSid}`,
        backfilled,
        metadata: { fromNumber, toNumber, threadId: String(threadRef) },
        ...(activityAt ? { createdAt: activityAt } : {}),
      },
      backfilled,
    );
  }
  if (customerRef && doc && opts.recordingUrl) {
    await recordInboundActivity(
      {
        customerRef,
        category: "communication",
        action: "recorded",
        summary: "A call recording was saved",
        actorKind: "system",
        actorName: "System",
        entityType: "twilio_communication",
        entityId: String(doc._id),
        source: backfilled ? "backfill" : "webhook",
        sourceEventId: `twilio:recording:${canonicalSid}`,
        backfilled,
        metadata: { threadId: String(threadRef) },
        ...(activityAt ? { createdAt: activityAt } : {}),
      },
      backfilled,
    );
  }

  if (!alreadyOnThread) {
    await touchInboundThread(
      threadRef,
      {
        direction: "inbound",
        channel: "voice",
        body: preview,
        transcript: mergedTranscript,
        at: opts.occurredAt ?? doc?.createdAt ?? new Date(),
      },
      Boolean(opts.occurredAt),
    );
    return;
  }

  if (incomingTranscript && threadRef) {
    const at = opts.occurredAt ?? new Date();
    if (opts.occurredAt) {
      const thread = await MessageThread.findById(threadRef)
        .select("lastMessageAt")
        .lean();
      const current = thread?.lastMessageAt
        ? new Date(thread.lastMessageAt).getTime()
        : null;
      if (current != null && at.getTime() < current) return;
    }
    await MessageThread.updateOne(
      { _id: threadRef },
      {
        $set: {
          lastMessageAt: at,
          lastMessageDirection: "inbound",
          lastMessageChannel: "voice",
          lastMessagePreview: preview.slice(0, PREVIEW_LENGTH),
        },
      },
    );
  }
}

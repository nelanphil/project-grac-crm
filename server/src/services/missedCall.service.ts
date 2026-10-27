import { ITwilioAccount } from "../models/mongo/TwilioAccount";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import {
  inboxPhoneHandle,
  isInboxHandleBlocked,
  touchFromTwilio,
} from "./inboxConversation.service";
import { sendSms } from "./twilio.service";
import { appendVoiceActivity } from "./voiceIvr.service";
import { toE164 } from "../utils/messagingContext";
import {
  resolveThreadForInbound,
  touchThreadAfterMessage,
} from "../utils/messageThreads";
import { isPubliclyReachableApiHost, resolvePublicApiBase } from "../utils/publicUrl";
import { phoneLinesMatch, normalizePhoneLines } from "../utils/twilioPhoneLines";

export const MISSED_CALL_TEXT =
  "Hey, sorry we missed your call. It is very important to us, please leave a message regarding your generator status or issue and we will get right back to you. Feel free to text back here as well\n\nThanks!";

export const MISSED_CALL_COOLDOWN_MS = 15 * 60 * 1000;

export type MissedCallSkipReason =
  | "missing"
  | "not-inbound"
  | "answered"
  | "already-sent"
  | "blocked"
  | "anonymous"
  | "no-sms"
  | "cooldown"
  | "send-failed";

export function decideMissedCallText(input: {
  answeredAt: Date | null;
  missedCallTextSentAt: Date | null;
  callerBlocked: boolean;
  callerE164: string | null;
  lineSmsCapable: boolean;
  recentTextAt: Date | null;
  now: Date;
  cooldownMs?: number;
}): { send: true } | { send: false; reason: MissedCallSkipReason } {
  if (input.answeredAt) return { send: false, reason: "answered" };
  if (input.missedCallTextSentAt) return { send: false, reason: "already-sent" };
  if (input.callerBlocked) return { send: false, reason: "blocked" };
  if (!input.callerE164) return { send: false, reason: "anonymous" };
  if (!input.lineSmsCapable) return { send: false, reason: "no-sms" };
  const cooldown = input.cooldownMs ?? MISSED_CALL_COOLDOWN_MS;
  if (
    input.recentTextAt &&
    input.now.getTime() - input.recentTextAt.getTime() < cooldown
  ) {
    return { send: false, reason: "cooldown" };
  }
  return { send: true };
}

function statusCallbackUrl(accountSid: string): string | undefined {
  const base = resolvePublicApiBase().replace(/\/$/, "");
  if (!isPubliclyReachableApiHost(base)) return undefined;
  return `${base}/webhooks/twilio/status?accountSid=${encodeURIComponent(accountSid)}`;
}

/**
 * Send the missed-call text at most once per inbound call.
 * A second webhook for the same call finds the claim and does nothing.
 */
export async function handleMissedInboundCall(input: {
  account: ITwilioAccount;
  callSid: string;
  fromNumber: string;
  toNumber: string;
}): Promise<{ sent: boolean; reason?: MissedCallSkipReason }> {
  const callSid = input.callSid.trim();
  if (!callSid) return { sent: false, reason: "missing" };

  const doc = await TwilioCommunication.findOne({
    accountSid: input.account.accountSid,
    twilioSid: callSid,
    channel: "voice",
  });
  if (!doc) return { sent: false, reason: "missing" };
  if (doc.direction !== "inbound") return { sent: false, reason: "not-inbound" };

  const callerE164 = toE164(input.fromNumber || doc.fromNumber || "");
  const handle = inboxPhoneHandle(input.fromNumber || doc.fromNumber);
  const callerBlocked = handle
    ? await isInboxHandleBlocked(handle, "phone")
    : false;
  const line = normalizePhoneLines(input.account.phoneNumbers).find((entry) =>
    phoneLinesMatch(entry.phoneNumber, input.toNumber || doc.toNumber),
  );
  const now = new Date();
  const recent = callerE164
    ? await TwilioCommunication.findOne({
        direction: "outbound",
        channel: { $in: ["sms", "mms"] },
        toNumber: callerE164,
        body: MISSED_CALL_TEXT,
        createdAt: { $gte: new Date(now.getTime() - MISSED_CALL_COOLDOWN_MS) },
      })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean()
    : null;

  const decision = decideMissedCallText({
    answeredAt: doc.answeredAt ?? null,
    missedCallTextSentAt: doc.missedCallTextSentAt ?? null,
    callerBlocked,
    callerE164,
    lineSmsCapable: Boolean(line?.sms),
    recentTextAt: recent?.createdAt ?? null,
    now,
  });

  const claimed = await TwilioCommunication.findOneAndUpdate(
    { _id: doc._id, answeredAt: null, missedCallTextSentAt: null },
    { $set: { missedCallTextSentAt: now } },
    { new: true },
  );
  if (!claimed) {
    return {
      sent: false,
      reason: doc.answeredAt ? "answered" : "already-sent",
    };
  }

  const stillOpen = await TwilioCommunication.findById(claimed._id)
    .select("answeredAt")
    .lean();
  if (stillOpen?.answeredAt) {
    await TwilioCommunication.updateOne(
      { _id: claimed._id },
      { $unset: { missedCallTextSentAt: 1 } },
    );
    return { sent: false, reason: "answered" };
  }

  if (!decision.send || !callerE164 || !line?.phoneNumber) {
    await appendVoiceActivity({
      accountSid: input.account.accountSid,
      callSid,
      line: "Missed call.",
    });
    return { sent: false, reason: decision.send ? "no-sms" : decision.reason };
  }

  const from = line.phoneNumber;
  try {
    const callback = statusCallbackUrl(input.account.accountSid);
    const { sid } = await sendSms({
      account: input.account,
      from,
      to: callerE164,
      body: MISSED_CALL_TEXT,
      statusCallbackUrl: callback,
    });

    try {
      let threadRef = claimed.threadRef ?? null;
      if (!threadRef) {
        const thread = await resolveThreadForInbound({
          contactRef: claimed.contactRef ?? null,
          customerRef: claimed.customerRef ?? null,
          twilioAccountRef: input.account._id,
          accountSid: input.account.accountSid,
          ourNumber: from,
          contactPhoneSnapshot: input.fromNumber || claimed.fromNumber,
        });
        threadRef = thread._id;
      }
      const sms = await TwilioCommunication.create({
        twilioAccountRef: input.account._id,
        accountSid: input.account.accountSid,
        channel: "sms",
        direction: "outbound",
        status: "sent",
        fromNumber: from,
        toNumber: callerE164,
        body: MISSED_CALL_TEXT,
        mediaUrls: [],
        twilioSid: sid,
        customerRef: claimed.customerRef ?? null,
        contactRef: claimed.contactRef ?? null,
        threadRef,
        createdByUserRef: null,
      });
      if (threadRef) {
        await touchThreadAfterMessage(threadRef, {
          direction: "outbound",
          channel: "sms",
          body: MISSED_CALL_TEXT,
          at: sms.createdAt ?? new Date(),
        });
      }
      await touchFromTwilio(sms, { countUnread: false, publish: true });
    } catch (err) {
      console.error("[voice] missed-call text sent but was not logged:", err);
    }

    await appendVoiceActivity({
      accountSid: input.account.accountSid,
      callSid,
      line: "Missed call.",
    });
    return { sent: true };
  } catch (err) {
    console.error("[voice] missed-call text failed:", err);
    await TwilioCommunication.updateOne(
      { _id: claimed._id, answeredAt: null },
      { $unset: { missedCallTextSentAt: 1 } },
    );
    return { sent: false, reason: "send-failed" };
  }
}

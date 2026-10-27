import { Request, Response } from "express";
import { Types } from "mongoose";
import twilio from "twilio";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { MessageThread } from "../models/mongo/MessageThread";
import { ITwilioAccount, TwilioAccount } from "../models/mongo/TwilioAccount";
import { User } from "../models/mongo/User";
import {
  mapTwilioCallStatus,
  mapTwilioMessageStatus,
} from "../utils/communicationFormat";
import {
  fetchRecordingTranscript,
  getAccountAuthToken,
  resolveAccountFromWebhook,
} from "../services/twilio.service";
import { touchThreadAfterMessage } from "../utils/messageThreads";
import { publishDashboardChanged } from "../services/dashboardLive";
import {
  inboxPhoneHandle,
  isInboxHandleBlocked,
  touchFromTwilio,
} from "../services/inboxConversation.service";
import { describeTwilioError } from "../utils/twilioErrorCodes";
import { inboundCallTwiml } from "../services/inboundRing.service";
import { handleMissedInboundCall } from "../services/missedCall.service";
import {
  appendVoiceActivity,
  formatVoicemailLine,
  handleIvrGather,
  mergeVoiceActivity,
  voicemailTwiml,
} from "../services/voiceIvr.service";
import { buildClientDialTwiml, buildSayHangupTwiml } from "../utils/twilioVoiceTwiml";
import { resolveSayVoice } from "../utils/twilioVoices";
import { VoiceCallIntent } from "../models/mongo/VoiceCallIntent";
import { evaluateVoiceIntent } from "../utils/voiceIntent";
import { resolvePublicApiBase, resolveVoiceWebhookBase } from "../utils/publicUrl";
import {
  completeCallTranscript,
  startCallTranscript,
} from "../services/callTranscription.service";
import {
  findVoiceCommunication,
  inboundVoiceBody,
  ingestInboundMessage,
  ingestInboundVoice,
  resolveInboundVoiceThread,
  voiceSidCandidates,
  withRecordingFirst,
} from "../services/twilioInboundIngest.service";

function asStringRecord(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body || typeof body !== "object") return out;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? String(value[0]) : String(value);
  }
  return out;
}

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw || "").split(",")[0].trim();
}

function webhookUrlCandidates(req: Request): string[] {
  const originalUrl = req.originalUrl || req.url || "";
  const host =
    firstHeaderValue(req.headers["x-forwarded-host"]) ||
    req.get("host") ||
    "";
  const proto =
    firstHeaderValue(req.headers["x-forwarded-proto"]) ||
    req.protocol ||
    "https";

  const urls = new Set<string>();
  if (host) {
    urls.add(`${proto}://${host}${originalUrl}`);
    urls.add(`https://${host}${originalUrl}`);
    urls.add(`http://${host}${originalUrl}`);
  }
  const configured = process.env.PUBLIC_API_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    urls.add(`${configured}${originalUrl}`);
  }
  return [...urls];
}

async function resolveAccount(req: Request) {
  const params = asStringRecord(req.body);
  const hint =
    (req.query.accountSid as string | undefined) || params.AccountSid || null;

  return resolveAccountFromWebhook({
    accountSidHint: hint,
    signature: req.get("X-Twilio-Signature") || undefined,
    url: webhookUrlCandidates(req),
    params,
  });
}

function collectMediaUrls(params: Record<string, string>): string[] {
  const count = parseInt(params.NumMedia || "0", 10) || 0;
  const urls: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const url = params[`MediaUrl${i}`];
    if (url) urls.push(url);
  }
  return urls;
}

const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const REJECT_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';

const PREVIEW_LENGTH = 160;

const TERMINAL_INBOUND_CALL = new Set([
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);

async function noteUnansweredInbound(
  account: ITwilioAccount,
  doc: {
    channel?: string | null;
    direction?: string | null;
    twilioSid?: string | null;
    fromNumber?: string | null;
    toNumber?: string | null;
    answeredAt?: Date | null;
  },
  status: string,
): Promise<void> {
  if (doc.channel !== "voice" || doc.direction !== "inbound") return;
  if (!TERMINAL_INBOUND_CALL.has(status)) return;
  if (doc.answeredAt) return;
  try {
    await handleMissedInboundCall({
      account,
      callSid: doc.twilioSid || "",
      fromNumber: doc.fromNumber || "",
      toNumber: doc.toNumber || "",
    });
  } catch (err) {
    console.error("Missed-call text failed:", err);
  }
}

function previewBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length <= PREVIEW_LENGTH
    ? trimmed
    : `${trimmed.slice(0, PREVIEW_LENGTH - 1)}…`;
}

// POST /webhooks/twilio/message
export async function inboundMessageWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const account = await resolveAccount(req);
    if (!account) {
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }

    const params = asStringRecord(req.body);
    const twilioSid = params.MessageSid || params.SmsSid;
    if (!twilioSid) {
      res.status(400).type("text/xml").send(EMPTY_TWIML);
      return;
    }

    await ingestInboundMessage({
      account,
      twilioSid,
      fromNumber: params.From || "",
      toNumber: params.To || "",
      body: params.Body || "",
      mediaUrls: collectMediaUrls(params),
      rawStatus: params.SmsStatus || params.MessageStatus || "received",
    });
    const fromHandle = inboxPhoneHandle(params.From || "");
    const blocked = fromHandle
      ? await isInboxHandleBlocked(fromHandle, "phone")
      : false;
    if (!blocked) publishDashboardChanged();

    res.status(200).type("text/xml").send(EMPTY_TWIML);
  } catch (err) {
    console.error("Twilio inbound message webhook error:", err);
    res.status(200).type("text/xml").send(EMPTY_TWIML);
  }
}

function recordingUrlFromParams(params: Record<string, string>): string {
  return params.RecordingUrl || params.RecordingUrl0 || "";
}

function transcriptFromParams(params: Record<string, string>): string {
  const status = (params.TranscriptionStatus || "").toLowerCase();
  if (status === "failed") return "";
  return (
    params.TranscriptionText ||
    params.Transcription ||
    params.TranscriptionText0 ||
    ""
  );
}

async function resolveCallTranscript(
  account: ITwilioAccount,
  params: Record<string, string>,
): Promise<string> {
  const fromParams = transcriptFromParams(params).trim();
  if (fromParams) return fromParams;
  return fetchRecordingTranscript(account, params.RecordingSid || "");
}

function parseDurationSeconds(params: Record<string, string>): number | null {
  const raw =
    params.RecordingDuration || params.CallDuration || params.Duration || "";
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// POST /webhooks/twilio/status
export async function statusWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const account = await resolveAccount(req);
    if (!account) {
      res.status(403).send("Forbidden");
      return;
    }

    const params = asStringRecord(req.body);
    const isCall = Boolean(params.CallSid || params.CallStatus || params.ParentCallSid);
    const callSids = isCall ? voiceSidCandidates(params) : [];
    const twilioSid = isCall
      ? params.ParentCallSid || params.CallSid || callSids[0] || ""
      : params.MessageSid || params.SmsSid || "";
    if (!twilioSid) {
      res.status(200).send("OK");
      return;
    }
    const status = isCall
      ? mapTwilioCallStatus(params.CallStatus || params.DialCallStatus)
      : mapTwilioMessageStatus(params.MessageStatus || params.SmsStatus);

    const durationRaw = params.CallDuration || params.Duration;
    const durationSeconds = durationRaw ? parseInt(durationRaw, 10) : null;

    const errorCode = params.ErrorCode || null;
    const errorMessage = errorCode
      ? describeTwilioError(errorCode, params.ErrorMessage || null)
      : params.ErrorMessage || null;

    const recordingUrl = isCall ? recordingUrlFromParams(params) : "";
    const transcript = isCall
      ? await resolveCallTranscript(account, params)
      : "";
    const fromNumber = params.From || "";
    const toNumber = params.To || "";

    const existing = isCall
      ? await findVoiceCommunication(account.accountSid, callSids)
      : await TwilioCommunication.findOne({
          accountSid: account.accountSid,
          twilioSid,
        });

    if (existing) {
      const mediaUrls = recordingUrl
        ? withRecordingFirst(existing.mediaUrls ?? [], recordingUrl)
        : undefined;

      const identity: Record<string, unknown> = {};
      if (existing.channel === "voice" && !existing.contactRef) {
        const resolved = await resolveInboundVoiceThread({
          account,
          fromNumber: fromNumber || existing.fromNumber,
          toNumber: toNumber || existing.toNumber,
        });
        if (resolved.contactRef) {
          identity.contactRef = resolved.contactRef;
          identity.customerRef = resolved.customerRef;
          identity.threadRef = resolved.thread._id;
        }
      }

      const nextTranscript = transcript
        ? existing.channel === "voice" && existing.direction === "inbound"
          ? mergeVoiceActivity(
              existing.transcript || "",
              formatVoicemailLine(transcript),
            )
          : transcript
        : "";

      await TwilioCommunication.updateOne(
        { _id: existing._id },
        {
          $set: {
            status,
            ...(Number.isFinite(durationSeconds as number)
              ? { durationSeconds }
              : {}),
            rawStatus:
              params.CallStatus ||
              params.MessageStatus ||
              params.SmsStatus ||
              null,
            errorMessage,
            ...(mediaUrls ? { mediaUrls } : {}),
            ...(nextTranscript
              ? {
                  transcript: nextTranscript,
                  body:
                    existing.channel === "voice" &&
                    existing.direction === "inbound"
                      ? inboundVoiceBody(nextTranscript)
                      : previewBody(nextTranscript),
                }
              : existing.channel === "voice" &&
                  existing.direction === "inbound"
                ? { body: inboundVoiceBody(existing.transcript || "") }
                : {}),
            ...identity,
          },
        },
      );

      const threadRef =
        (identity.threadRef as typeof existing.threadRef | undefined) ??
        existing.threadRef;
      if (nextTranscript && threadRef) {
        const listPreview =
          existing.channel === "voice" && existing.direction === "inbound"
            ? inboundVoiceBody(nextTranscript)
            : previewBody(nextTranscript);
        await MessageThread.updateOne(
          { _id: threadRef },
          {
            $set: {
              lastMessagePreview: listPreview,
              lastMessageChannel: "voice",
            },
          },
        );
      } else if (
        identity.threadRef &&
        String(identity.threadRef) !== String(existing.threadRef ?? "")
      ) {
        await touchThreadAfterMessage(identity.threadRef as Types.ObjectId, {
          direction: existing.direction === "outbound" ? "outbound" : "inbound",
          channel: "voice",
          body: existing.body === "Voice message" ? "" : existing.body,
          transcript: existing.transcript || "",
          at: existing.createdAt ?? new Date(),
        });
      }

      if (existing.channel === "voice") {
        const fresh = await TwilioCommunication.findById(existing._id);
        if (fresh) {
          await touchFromTwilio(fresh, { countUnread: false, publish: true });
          await noteUnansweredInbound(account, fresh, status);
        }
      }

      res.status(200).send("OK");
      return;
    }

    if (isCall) {
      const resolved = await resolveInboundVoiceThread({
        account,
        fromNumber,
        toNumber,
        preferOutbound: true,
      });

      const storedTranscript =
        resolved.direction === "inbound" && transcript
          ? formatVoicemailLine(transcript)
          : transcript;
      const body =
        resolved.direction === "inbound"
          ? inboundVoiceBody(storedTranscript)
          : previewBody(storedTranscript);
      const mediaUrls = recordingUrl ? [recordingUrl] : [];

      const doc = await TwilioCommunication.create({
        twilioAccountRef: account._id,
        accountSid: account.accountSid,
        channel: "voice",
        direction: resolved.direction,
        status,
        fromNumber,
        toNumber,
        body,
        transcript: storedTranscript,
        mediaUrls,
        durationSeconds: Number.isFinite(durationSeconds as number)
          ? durationSeconds
          : null,
        twilioSid,
        customerRef: resolved.customerRef,
        contactRef: resolved.contactRef,
        threadRef: resolved.thread._id,
        createdByUserRef: null,
        errorMessage,
        rawStatus: params.CallStatus || null,
      });

      await touchThreadAfterMessage(resolved.thread._id, {
        direction: resolved.direction,
        channel: "voice",
        body,
        transcript: storedTranscript,
        at: doc.createdAt ?? new Date(),
      });
      await touchFromTwilio(doc, {
        countUnread: resolved.direction === "inbound",
        publish: true,
      });
      await noteUnansweredInbound(account, doc, status);

      res.status(200).send("OK");
      return;
    }

    await TwilioCommunication.findOneAndUpdate(
      { accountSid: account.accountSid, twilioSid },
      {
        $set: {
          status,
          rawStatus:
            params.CallStatus ||
            params.MessageStatus ||
            params.SmsStatus ||
            null,
          errorMessage,
        },
        $setOnInsert: {
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          channel: "sms",
          direction: "outbound",
          fromNumber,
          toNumber,
          body: "",
          transcript: "",
          mediaUrls: [],
        },
      },
      { upsert: true },
    );

    res.status(200).send("OK");
  } catch (err) {
    console.error("Twilio status webhook error:", err);
    res.status(200).send("OK");
  }
}

function thankYouHangupTwiml(account: ITwilioAccount): string {
  return buildSayHangupTwiml(
    "Thank you for your message. Goodbye.",
    resolveSayVoice(account.sayVoice),
  );
}

// POST /webhooks/twilio/voice
export async function inboundVoiceWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  let account: ITwilioAccount | null = null;
  try {
    account = await resolveAccount(req);
    if (!account) {
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }

    const params = asStringRecord(req.body);
    const callSid = params.CallSid || "";
    const fromNumber = params.From || params.Caller || "";
    const toNumber = params.To || params.Called || "";
    const caller = inboxPhoneHandle(fromNumber);
    if (caller && (await isInboxHandleBlocked(caller, "phone"))) {
      res.status(200).type("text/xml").send(REJECT_TWIML);
      return;
    }
    if (!callSid) {
      res.status(200).type("text/xml").send(voicemailTwiml(account));
      return;
    }

    try {
      await ingestInboundVoice({
        account,
        callSid,
        fromNumber,
        toNumber,
        statusRaw: params.CallStatus,
        defaultStatus: "in-progress",
      });
    } catch (err) {
      console.error("Twilio inbound voice ingest error:", err);
    }

    const twiml = await inboundCallTwiml({
      account,
      callSid,
      fromNumber,
      toNumber,
    });
    res.status(200).type("text/xml").send(twiml);
  } catch (err) {
    console.error("Twilio inbound voice webhook error:", err);
    if (account) {
      res
        .status(200)
        .type("text/xml")
        .send(voicemailTwiml(account, "I'm sorry, something went wrong."));
      return;
    }
    res.status(200).type("text/xml").send(EMPTY_TWIML);
  }
}

// POST /webhooks/twilio/voice/gather
export async function inboundVoiceGatherWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  let account: ITwilioAccount | null = null;
  try {
    account = await resolveAccount(req);
    if (!account) {
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }

    const params = asStringRecord(req.body);
    const twiml = await handleIvrGather({ account, params });
    res.status(200).type("text/xml").send(twiml);
  } catch (err) {
    console.error("Twilio inbound voice gather webhook error:", err);
    if (account) {
      res
        .status(200)
        .type("text/xml")
        .send(voicemailTwiml(account, "I'm sorry, something went wrong."));
      return;
    }
    res.status(200).type("text/xml").send(EMPTY_TWIML);
  }
}

// POST /webhooks/twilio/voice/recording
export async function inboundVoiceRecordingWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  let account: ITwilioAccount | null = null;
  try {
    account = await resolveAccount(req);
    if (!account) {
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }

    const params = asStringRecord(req.body);
    const callSid = params.CallSid || params.ParentCallSid || "";
    if (!callSid) {
      res.status(200).type("text/xml").send(thankYouHangupTwiml(account));
      return;
    }

    const failedStatuses = new Set([
      "busy",
      "no-answer",
      "no_answer",
      "failed",
      "canceled",
      "cancelled",
    ]);
    const callStatus = (params.CallStatus || "").toLowerCase();
    const statusRaw = failedStatuses.has(callStatus)
      ? params.CallStatus
      : "completed";

    await ingestInboundVoice({
      account,
      callSid,
      parentCallSid: params.ParentCallSid || undefined,
      fromNumber: params.From || params.Caller || "",
      toNumber: params.To || params.Called || "",
      statusRaw,
      defaultStatus: "completed",
      transcript:
        (await resolveCallTranscript(account, params)) || undefined,
      recordingUrl: recordingUrlFromParams(params) || undefined,
      durationSeconds: parseDurationSeconds(params),
    });
    if (params.RecordingSid) {
      const saved = await findVoiceCommunication(account.accountSid, [
        callSid,
        params.ParentCallSid || "",
      ].filter(Boolean));
      if (saved) {
        if (saved.transcript && !saved.transcriptSource) saved.transcriptSource = "basic";
        await startCallTranscript(account, saved, params.RecordingSid);
      }
    }

    res.status(200).type("text/xml").send(thankYouHangupTwiml(account));
  } catch (err) {
    console.error("Twilio inbound voice recording webhook error:", err);
    if (account) {
      res.status(200).type("text/xml").send(thankYouHangupTwiml(account));
      return;
    }
    res.status(200).type("text/xml").send(EMPTY_TWIML);
  }
}

const ANSWERED_IGNORE = new Set([
  "ringing",
  "initiated",
  "queued",
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "cancelled",
]);

function staffDisplayName(user: {
  first_name?: string | null;
  last_name?: string | null;
} | null): string {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return name || "a teammate";
}

// POST /webhooks/twilio/voice/inbound/answered
export async function inboundVoiceAnsweredWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const account = await resolveAccount(req);
    if (!account) {
      res.status(403).send("Forbidden");
      return;
    }
    const params = asStringRecord(req.body);
    const status = (params.CallStatus || "").toLowerCase();
    if (status && ANSWERED_IGNORE.has(status)) {
      res.status(200).send("OK");
      return;
    }
    const userId = String(req.query.userId || "");
    const sids = [params.ParentCallSid, params.CallSid].filter(Boolean);
    const doc = sids.length
      ? await findVoiceCommunication(account.accountSid, sids)
      : null;
    if (!doc) {
      res.status(200).send("OK");
      return;
    }
    const answeredBy = Types.ObjectId.isValid(userId)
      ? new Types.ObjectId(userId)
      : null;
    const updated = await TwilioCommunication.findOneAndUpdate(
      { _id: doc._id, answeredAt: null },
      {
        $set: {
          answeredAt: new Date(),
          ...(answeredBy ? { answeredByUserRef: answeredBy } : {}),
        },
      },
      { new: true },
    );
    if (updated) {
      const user = answeredBy
        ? await User.findById(answeredBy).select("first_name last_name").lean()
        : null;
      await appendVoiceActivity({
        accountSid: account.accountSid,
        callSid: updated.twilioSid || doc.twilioSid || "",
        line: `Answered by ${staffDisplayName(user)}.`,
      });
      await touchFromTwilio(updated, { countUnread: false, publish: true });
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error("POST /webhooks/twilio/voice/inbound/answered error:", err);
    res.status(200).send("OK");
  }
}

// POST /webhooks/twilio/voice/inbound/complete
export async function inboundVoiceCompleteWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  let account: ITwilioAccount | null = null;
  try {
    account = await resolveAccount(req);
    if (!account) {
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }
    const params = asStringRecord(req.body);
    const dialStatus = (params.DialCallStatus || "").toLowerCase();
    const callSid = params.CallSid || params.ParentCallSid || "";
    const existing = callSid
      ? await findVoiceCommunication(account.accountSid, [callSid])
      : null;
    if (
      dialStatus === "completed" ||
      dialStatus === "answered" ||
      existing?.answeredAt
    ) {
      if (callSid && !existing?.answeredAt) {
        await TwilioCommunication.updateOne(
          {
            accountSid: account.accountSid,
            twilioSid: callSid,
            channel: "voice",
            answeredAt: null,
          },
          { $set: { answeredAt: new Date() } },
        );
      }
      res.status(200).type("text/xml").send(EMPTY_TWIML);
      return;
    }
    await handleMissedInboundCall({
      account,
      callSid,
      fromNumber: params.From || params.Caller || "",
      toNumber: params.To || params.Called || "",
    });
    res
      .status(200)
      .type("text/xml")
      .send(voicemailTwiml(account, "Sorry we missed your call."));
  } catch (err) {
    console.error("POST /webhooks/twilio/voice/inbound/complete error:", err);
    if (account) {
      res
        .status(200)
        .type("text/xml")
        .send(voicemailTwiml(account, "Sorry we missed your call."));
      return;
    }
    res.status(200).type("text/xml").send(EMPTY_TWIML);
  }
}

function clientIdentity(from: string): string {
  return from.replace(/^client:/i, "");
}

function voiceClientActionUrl(intentId: string, storedBase?: string): string {
  const base =
    resolveVoiceWebhookBase(resolvePublicApiBase(), storedBase) ||
    resolvePublicApiBase().replace(/\/$/, "");
  return `${base}/webhooks/twilio/voice/client/complete?intentId=${encodeURIComponent(intentId)}`;
}

function voiceClientRecordingUrl(intentId: string, storedBase?: string): string {
  const base =
    resolveVoiceWebhookBase(resolvePublicApiBase(), storedBase) ||
    resolvePublicApiBase().replace(/\/$/, "");
  return `${base}/webhooks/twilio/voice/client/recording?intentId=${encodeURIComponent(intentId)}`;
}

function voiceStatusLabel(status: string, durationSeconds: number): string {
  const label =
    status === "completed"
      ? "Call answered"
      : status === "no-answer"
        ? "No answer"
        : status === "busy"
          ? "Busy"
          : status === "failed"
            ? "Call failed"
            : status === "canceled"
              ? "Call canceled"
              : "Call ended";
  return durationSeconds > 0 ? `${label} · ${durationSeconds}s` : label;
}

// POST /webhooks/twilio/voice/client
export async function clientVoiceWebhook(req: Request, res: Response): Promise<void> {
  try {
    const account = await resolveAccount(req);
    if (!account) {
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }
    const params = asStringRecord(req.body);
    const intentId = params.intentId || String(req.query.intentId || "");
    const callSid = params.CallSid || "";
    if (!Types.ObjectId.isValid(intentId) || !callSid) {
      res.status(200).type("text/xml").send(buildSayHangupTwiml("This call could not be connected."));
      return;
    }
    const intent = await VoiceCallIntent.findById(intentId);
    if (!intent || intent.accountSid !== account.accountSid) {
      res.status(200).type("text/xml").send(buildSayHangupTwiml("This call could not be connected."));
      return;
    }
    const decision = evaluateVoiceIntent({
      userId: String(intent.userRef),
      expiresAt: intent.expiresAt,
      twilioCallSid: intent.twilioCallSid || "",
      identity: clientIdentity(params.From || ""),
      callSid,
      now: new Date(),
    });
    if (!decision.ok) {
      console.warn("[voice] client webhook refused:", decision.message);
      res.status(200).type("text/xml").send(buildSayHangupTwiml("This call could not be connected."));
      return;
    }

    if (!decision.replay) {
      intent.twilioCallSid = callSid;
      await intent.save();
      const doc = await TwilioCommunication.create({
        twilioAccountRef: intent.twilioAccountRef,
        accountSid: intent.accountSid,
        channel: "voice",
        direction: "outbound",
        status: "ringing",
        fromNumber: intent.fromNumber,
        toNumber: intent.toNumber,
        body: "Outbound call",
        mediaUrls: [],
        twilioSid: callSid,
        customerRef: intent.customerRef,
        contactRef: intent.contactRef,
        threadRef: intent.threadRef,
        createdByUserRef: intent.userRef,
      });
      if (intent.threadRef) {
        await touchThreadAfterMessage(intent.threadRef, {
          direction: "outbound",
          channel: "voice",
          body: "Outbound call",
          at: new Date(),
        });
      }
      await touchFromTwilio(doc, {
        countUnread: false,
        publish: true,
        actorUserId: String(intent.userRef),
      });
    }

    res.status(200).type("text/xml").send(
      buildClientDialTwiml({
        from: intent.fromNumber,
        to: intent.toNumber,
        actionUrl: voiceClientActionUrl(intentId, account.voicePublicBaseUrl),
        recordingStatusCallbackUrl: voiceClientRecordingUrl(intentId, account.voicePublicBaseUrl),
      }),
    );
  } catch (err) {
    console.error("POST /webhooks/twilio/voice/client error:", err);
    res.status(200).type("text/xml").send(buildSayHangupTwiml("This call could not be connected."));
  }
}

// POST /webhooks/twilio/voice/client/recording
export async function clientVoiceRecordingWebhook(req: Request, res: Response): Promise<void> {
  try {
    const account = await resolveAccount(req);
    if (!account) {
      res.status(403).send("Forbidden");
      return;
    }
    const params = asStringRecord(req.body);
    if ((params.RecordingStatus || "").toLowerCase() !== "completed") {
      res.status(200).send("OK");
      return;
    }
    const intentId = String(req.query.intentId || "");
    const intent = Types.ObjectId.isValid(intentId)
      ? await VoiceCallIntent.findById(intentId).select("twilioCallSid").lean()
      : null;
    const callSids = [params.CallSid, params.ParentCallSid, intent?.twilioCallSid || ""].filter(
      Boolean,
    );
    const doc = callSids.length
      ? await TwilioCommunication.findOne({ twilioSid: { $in: callSids }, channel: "voice" })
      : null;
    if (doc) {
      const recordingUrl = recordingUrlFromParams(params);
      if (recordingUrl && !doc.mediaUrls.includes(recordingUrl)) {
        doc.mediaUrls.unshift(recordingUrl);
        await doc.save();
      }
      await startCallTranscript(account, doc, params.RecordingSid || "");
      await touchFromTwilio(doc, {
        countUnread: false,
        publish: true,
        actorUserId: doc.createdByUserRef ? String(doc.createdByUserRef) : null,
      });
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error("POST /webhooks/twilio/voice/client/recording error:", err);
    res.status(200).send("OK");
  }
}

function intelligenceBody(req: Request): Record<string, unknown> {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

// POST /webhooks/twilio/intelligence
export async function intelligenceWebhook(req: Request, res: Response): Promise<void> {
  try {
    const body = intelligenceBody(req);
    const transcriptSid = String(body.transcript_sid || body.transcriptSid || "");
    const eventType = String(body.event_type || body.eventType || "");
    if (eventType && !/transcript/i.test(eventType)) {
      res.status(200).send("OK");
      return;
    }
    const hint = String(req.query.accountSid || body.account_sid || "");
    const account = hint ? await TwilioAccount.findOne({ accountSid: hint }) : null;
    if (!account) {
      res.status(403).send("Forbidden");
      return;
    }
    const raw = (req as Request & { rawBody?: string }).rawBody || "";
    const signature = req.get("X-Twilio-Signature") || "";
    const token = getAccountAuthToken(account);
    const urls = new Set(webhookUrlCandidates(req));
    if (account.voicePublicBaseUrl) {
      urls.add(`${account.voicePublicBaseUrl.replace(/\/+$/, "")}${req.originalUrl || req.url || ""}`);
    }
    const signed = [...urls].some((url) => {
      if (raw && twilio.validateRequestWithBody(token, signature, url, raw)) return true;
      return twilio.validateRequest(token, signature, url, asStringRecord(req.body));
    });
    if (!signed) {
      res.status(403).send("Forbidden");
      return;
    }
    if (transcriptSid) await completeCallTranscript(transcriptSid);
    res.status(200).send("OK");
  } catch (err) {
    console.error("POST /webhooks/twilio/intelligence error:", err);
    res.status(200).send("OK");
  }
}

// POST /webhooks/twilio/voice/client/complete
export async function clientVoiceCompleteWebhook(req: Request, res: Response): Promise<void> {
  try {
    const account = await resolveAccount(req);
    if (!account) {
      res.status(403).type("text/xml").send(EMPTY_TWIML);
      return;
    }
    const params = asStringRecord(req.body);
    const callSid = params.CallSid || "";
    const status = mapTwilioCallStatus(params.DialCallStatus || params.CallStatus);
    const durationSeconds = Math.max(0, parseInt(params.DialCallDuration || "0", 10) || 0);
    const body = voiceStatusLabel(status, durationSeconds);
    const doc = callSid
      ? await TwilioCommunication.findOne({ twilioSid: callSid, channel: "voice" })
      : null;
    if (doc) {
      doc.status = status;
      doc.durationSeconds = durationSeconds;
      doc.body = body;
      doc.rawStatus = params.DialCallStatus || params.CallStatus || "";
      await doc.save();
      if (doc.threadRef) {
        await MessageThread.updateOne(
          { _id: doc.threadRef },
          {
            $set: {
              lastMessageAt: new Date(),
              lastMessagePreview: body,
              lastMessageChannel: "voice",
              lastMessageDirection: "outbound",
            },
          },
        );
      }
      await touchFromTwilio(doc, {
        countUnread: false,
        publish: true,
        actorUserId: doc.createdByUserRef ? String(doc.createdByUserRef) : null,
      });
    }
    res.status(200).type("text/xml").send(EMPTY_TWIML);
  } catch (err) {
    console.error("POST /webhooks/twilio/voice/client/complete error:", err);
    res.status(200).type("text/xml").send(EMPTY_TWIML);
  }
}

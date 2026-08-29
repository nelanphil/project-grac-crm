import { Request, Response } from "express";
import { Types } from "mongoose";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { MessageThread } from "../models/mongo/MessageThread";
import { ITwilioAccount } from "../models/mongo/TwilioAccount";
import {
  findContactByPhone,
  mapTwilioCallStatus,
  mapTwilioMessageStatus,
} from "../utils/communicationFormat";
import {
  fetchRecordingTranscript,
  resolveAccountFromWebhook,
} from "../services/twilio.service";
import {
  normalizeThreadPhone,
  resolveThreadForInbound,
  touchThreadAfterMessage,
} from "../utils/messageThreads";
import { toE164 } from "../utils/messagingContext";
import { normalizePhoneDigits } from "../utils/customerSites";
import { describeTwilioError } from "../utils/twilioErrorCodes";
import {
  formatVoicemailLine,
  handleIvrGather,
  mergeVoiceActivity,
  startInboundIvr,
  voicemailTwiml,
} from "../services/voiceIvr.service";
import { buildSayHangupTwiml } from "../utils/twilioVoiceTwiml";
import { resolveSayVoice } from "../utils/twilioVoices";

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
  const numbers = account.phoneNumbers ?? [];
  return numbers.some((n) => phonesMatch(n, phone));
}

const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const PREVIEW_LENGTH = 160;

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

    const fromNumber = params.From || "";
    const toNumber = params.To || "";
    const body = params.Body || "";
    const mediaUrls = collectMediaUrls(params);
    const channel = mediaUrls.length > 0 ? "mms" : "sms";
    const matched = fromNumber ? await findContactByPhone(fromNumber) : null;
    const ourNumber = toE164(toNumber) ?? toNumber;
    const snapshot = normalizeThreadPhone(fromNumber);
    // Unique open thread is (contactRef, ourNumber). customerRef is grouping only.
    const contactRef = matched?.contactRef ?? null;
    const customerRef = matched?.customerRef ?? null;

    const thread = await resolveThreadForInbound({
      contactRef,
      customerRef,
      twilioAccountRef: account._id,
      accountSid: account.accountSid,
      ourNumber,
      contactPhoneSnapshot: snapshot,
    });
    const threadRef = thread._id;

    const doc = await TwilioCommunication.findOneAndUpdate(
      { accountSid: account.accountSid, twilioSid },
      {
        $set: {
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
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
          rawStatus: params.SmsStatus || params.MessageStatus || "received",
        },
        $setOnInsert: {
          createdByUserRef: null,
          transcript: "",
        },
      },
      { upsert: true, new: true },
    );

    await touchThreadAfterMessage(threadRef, {
      direction: "inbound",
      channel,
      body,
      at: doc?.createdAt ?? new Date(),
    });

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

function withRecordingFirst(existing: string[], recordingUrl: string): string[] {
  if (!recordingUrl) return existing;
  const rest = existing.filter((u) => u !== recordingUrl);
  return [recordingUrl, ...rest];
}

async function resolveInboundVoiceThread(params: {
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

async function ingestInboundVoice(opts: {
  account: ITwilioAccount;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  statusRaw?: string;
  defaultStatus: "in-progress" | "completed";
  transcript?: string;
  recordingUrl?: string;
  durationSeconds?: number | null;
}): Promise<void> {
  const existing = await TwilioCommunication.findOne({
    accountSid: opts.account.accountSid,
    twilioSid: opts.callSid,
  });

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
  };

  if (incomingTranscript) {
    $set.transcript = mergedTranscript;
    $set.body = previewBody(mergedTranscript);
  } else if (!existing) {
    $set.body = "";
    $set.transcript = "";
  } else if (existing.body === "Voice message") {
    $set.body = "";
  }

  if (opts.recordingUrl) {
    $set.mediaUrls = withRecordingFirst(existing?.mediaUrls ?? [], opts.recordingUrl);
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
    { accountSid: opts.account.accountSid, twilioSid: opts.callSid },
    {
      $set,
      $setOnInsert: {
        createdByUserRef: null,
        twilioSid: opts.callSid,
      },
    },
    { upsert: true, new: true },
  );

  const preview =
    (typeof $set.body === "string" && $set.body) ||
    (existing?.body && existing.body !== "Voice message" ? existing.body : "") ||
    "";

  if (!alreadyOnThread) {
    await touchThreadAfterMessage(threadRef, {
      direction: "inbound",
      channel: "voice",
      body: preview,
      transcript: mergedTranscript,
      at: doc?.createdAt ?? new Date(),
    });
    return;
  }

  if (incomingTranscript && threadRef) {
    await MessageThread.updateOne(
      { _id: threadRef },
      {
        $set: {
          lastMessageAt: new Date(),
          lastMessageDirection: "inbound",
          lastMessageChannel: "voice",
          lastMessagePreview: preview.slice(0, PREVIEW_LENGTH),
        },
      },
    );
  }
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
    const twilioSid =
      params.MessageSid ||
      params.SmsSid ||
      params.CallSid ||
      params.ParentCallSid;
    if (!twilioSid) {
      res.status(200).send("OK");
      return;
    }

    const isCall = Boolean(params.CallSid || params.CallStatus);
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

    const existing = await TwilioCommunication.findOne({
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
              ? { transcript: nextTranscript, body: previewBody(nextTranscript) }
              : {}),
            ...identity,
          },
        },
      );

      const threadRef =
        (identity.threadRef as typeof existing.threadRef | undefined) ??
        existing.threadRef;
      if (nextTranscript && threadRef) {
        await MessageThread.updateOne(
          { _id: threadRef },
          {
            $set: {
              lastMessagePreview: previewBody(nextTranscript),
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
      const body = previewBody(storedTranscript);
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

    const twiml = await startInboundIvr({
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
      fromNumber: params.From || params.Caller || "",
      toNumber: params.To || params.Called || "",
      statusRaw,
      defaultStatus: "completed",
      transcript:
        (await resolveCallTranscript(account, params)) || undefined,
      recordingUrl: recordingUrlFromParams(params) || undefined,
      durationSeconds: parseDurationSeconds(params),
    });

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

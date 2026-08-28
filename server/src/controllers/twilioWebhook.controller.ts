import { Request, Response } from "express";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { MessageThread } from "../models/mongo/MessageThread";
import { ITwilioAccount } from "../models/mongo/TwilioAccount";
import {
  findContactByPhone,
  mapTwilioCallStatus,
  mapTwilioMessageStatus,
} from "../utils/communicationFormat";
import { resolveAccountFromWebhook } from "../services/twilio.service";
import {
  normalizeThreadPhone,
  resolveThreadForInbound,
  touchThreadAfterMessage,
} from "../utils/messageThreads";
import { toE164 } from "../utils/messagingContext";
import { normalizePhoneDigits } from "../utils/customerSites";
import { describeTwilioError } from "../utils/twilioErrorCodes";

function asStringRecord(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body || typeof body !== "object") return out;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? String(value[0]) : String(value);
  }
  return out;
}

function buildWebhookUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.get("host") || "localhost";
  return `${proto}://${host}${req.originalUrl}`;
}

async function resolveAccount(req: Request) {
  const params = asStringRecord(req.body);
  const hint =
    (req.query.accountSid as string | undefined) || params.AccountSid || null;

  return resolveAccountFromWebhook({
    accountSidHint: hint,
    signature: req.get("X-Twilio-Signature") || undefined,
    url: buildWebhookUrl(req),
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

    let threadRef = null;
    if (matched || snapshot) {
      const thread = await resolveThreadForInbound({
        contactRef: matched?.contactRef ?? null,
        customerRef: matched?.customerRef ?? null,
        twilioAccountRef: account._id,
        accountSid: account.accountSid,
        ourNumber,
        contactPhoneSnapshot: snapshot,
      });
      threadRef = thread._id;
    }

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
          customerRef: matched?.customerRef ?? null,
          contactRef: matched?.contactRef ?? null,
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

    if (threadRef) {
      await touchThreadAfterMessage(threadRef, {
        direction: "inbound",
        channel,
        body,
        at: doc?.createdAt ?? new Date(),
      });
    }

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
  return (
    params.TranscriptionText ||
    params.Transcription ||
    params.TranscriptionText0 ||
    ""
  );
}

function withRecordingFirst(existing: string[], recordingUrl: string): string[] {
  if (!recordingUrl) return existing;
  const rest = existing.filter((u) => u !== recordingUrl);
  return [recordingUrl, ...rest];
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
    const transcript = isCall ? transcriptFromParams(params) : "";
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
            ...(transcript ? { transcript, body: transcript } : {}),
          },
        },
      );

      if (transcript && existing.threadRef) {
        await MessageThread.updateOne(
          { _id: existing.threadRef },
          {
            $set: {
              lastMessagePreview: transcript.slice(0, 160),
              lastMessageChannel: "voice",
            },
          },
        );
      }

      res.status(200).send("OK");
      return;
    }

    if (isCall) {
      const outbound = fromNumber ? isOurNumber(account, fromNumber) : false;
      const direction = outbound ? "outbound" : "inbound";
      const ourNumberRaw = outbound ? fromNumber : toNumber;
      const theirNumber = outbound ? toNumber : fromNumber;
      const ourNumber = toE164(ourNumberRaw) ?? ourNumberRaw;
      const snapshot = normalizeThreadPhone(theirNumber);
      const matched = theirNumber
        ? await findContactByPhone(theirNumber)
        : null;

      const thread = await resolveThreadForInbound({
        contactRef: matched?.contactRef ?? null,
        customerRef: matched?.customerRef ?? null,
        twilioAccountRef: account._id,
        accountSid: account.accountSid,
        ourNumber,
        contactPhoneSnapshot: snapshot,
      });

      const body = transcript;
      const mediaUrls = recordingUrl ? [recordingUrl] : [];

      const doc = await TwilioCommunication.create({
        twilioAccountRef: account._id,
        accountSid: account.accountSid,
        channel: "voice",
        direction,
        status,
        fromNumber,
        toNumber,
        body,
        transcript,
        mediaUrls,
        durationSeconds: Number.isFinite(durationSeconds as number)
          ? durationSeconds
          : null,
        twilioSid,
        customerRef: matched?.customerRef ?? null,
        contactRef: matched?.contactRef ?? null,
        threadRef: thread._id,
        createdByUserRef: null,
        errorMessage,
        rawStatus: params.CallStatus || null,
      });

      await touchThreadAfterMessage(thread._id, {
        direction,
        channel: "voice",
        body,
        transcript,
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

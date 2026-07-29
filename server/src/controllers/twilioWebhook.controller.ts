import { Request, Response } from "express";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import {
  findContactByPhone,
  mapTwilioCallStatus,
  mapTwilioMessageStatus,
} from "../utils/communicationFormat";
import { resolveAccountFromWebhook } from "../services/twilio.service";
import { resolveThreadForInbound, touchThreadAfterMessage } from "../utils/messageThreads";
import { toE164 } from "../utils/messagingContext";

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
    (req.query.accountSid as string | undefined) ||
    params.AccountSid ||
    null;

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

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

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

    let threadRef = null;
    if (matched) {
      const ourNumber = toE164(toNumber) ?? toNumber;
      const thread = await resolveThreadForInbound({
        contactRef: matched.contactRef,
        customerRef: matched.customerRef,
        twilioAccountRef: account._id,
        accountSid: account.accountSid,
        ourNumber,
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
      params.MessageSid || params.SmsSid || params.CallSid || params.ParentCallSid;
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

    await TwilioCommunication.findOneAndUpdate(
      { accountSid: account.accountSid, twilioSid },
      {
        $set: {
          status,
          ...(Number.isFinite(durationSeconds as number)
            ? { durationSeconds }
            : {}),
          rawStatus: params.CallStatus || params.MessageStatus || params.SmsStatus || null,
          errorMessage: params.ErrorMessage || params.ErrorCode || null,
        },
        $setOnInsert: {
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          channel: isCall ? "voice" : "sms",
          direction: "outbound",
          fromNumber: params.From || "",
          toNumber: params.To || "",
          body: "",
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

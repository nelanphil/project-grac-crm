import twilio from "twilio";
import { Types } from "mongoose";
import { TwilioAccount, ITwilioAccount } from "../models/mongo/TwilioAccount";
import { decryptCredential } from "../utils/credentialsCrypto";
import { describeTwilioError } from "../utils/twilioErrorCodes";
import { resolvePublicApiBase } from "../utils/publicUrl";
import { buildOutboundSayTwiml } from "../utils/twilioVoiceTwiml";

export class TwilioServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioServiceError";
  }
}

function resolveAuthToken(account: ITwilioAccount): string {
  const encrypted = account.authTokenEncrypted;

  if (!encrypted) {
    throw new TwilioServiceError("Twilio account is missing an auth token");
  }

  return decryptCredential(encrypted);
}

export type TwilioRuntimeEnvironment = "development" | "production";
export type TwilioCredentialPair = "live" | "test";

export function getTwilioRuntimeEnvironment(): TwilioRuntimeEnvironment {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** Credential pair this process actually uses for Twilio API calls. */
export function getTwilioCredentialPair(): TwilioCredentialPair {
  return "live";
}

/**
 * Resolves the Account SID + Auth Token pair to use for Twilio API calls
 * and webhook signature validation.
 *
 * Always uses the live Account SID + auth token so local development and
 * production send, receive, and validate against the same saved account.
 * Optional test SID/token fields are stored but not selected automatically.
 */
function resolveCredentials(account: ITwilioAccount): {
  accountSid: string;
  authToken: string;
} {
  return {
    accountSid: account.accountSid,
    authToken: resolveAuthToken(account),
  };
}

export function getAccountAuthToken(account: ITwilioAccount): string {
  return resolveAuthToken(account);
}

export async function getTwilioAccountForSend(
  accountId?: string,
): Promise<ITwilioAccount> {
  if (accountId) {
    if (!Types.ObjectId.isValid(accountId)) {
      throw new TwilioServiceError("Invalid Twilio account id");
    }
    const account = await TwilioAccount.findById(accountId);
    if (!account || !account.isActive) {
      throw new TwilioServiceError("Twilio account not found or inactive");
    }
    return account;
  }

  const account = await TwilioAccount.findOne({ isActive: true }).sort({
    friendlyName: 1,
  });
  if (!account) {
    throw new TwilioServiceError("No active Twilio account configured");
  }
  return account;
}

export function resolveFromNumber(
  account: ITwilioAccount,
  fromNumber?: string,
): string {
  const numbers = account.phoneNumbers ?? [];
  if (numbers.length === 0) {
    throw new TwilioServiceError(
      "Twilio account has no phone numbers configured",
    );
  }

  if (fromNumber) {
    const match = numbers.find(
      (n) =>
        n.trim() === fromNumber.trim() ||
        n.replace(/\D/g, "") === fromNumber.replace(/\D/g, ""),
    );
    if (!match) {
      throw new TwilioServiceError(
        "fromNumber is not registered on the selected Twilio account",
      );
    }
    return match;
  }

  return numbers[0];
}

export async function sendSms(params: {
  account: ITwilioAccount;
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
  statusCallbackUrl?: string;
}): Promise<{ sid: string }> {
  const { accountSid, authToken } = resolveCredentials(params.account);
  const client = twilio(accountSid, authToken);

  try {
    const mediaUrl =
      params.mediaUrls && params.mediaUrls.length > 0
        ? params.mediaUrls
        : undefined;

    const message = await client.messages.create({
      from: params.from,
      to: params.to,
      body: params.body,
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(params.statusCallbackUrl
        ? { statusCallback: params.statusCallbackUrl }
        : {}),
    });
    return { sid: message.sid };
  } catch (err) {
    const code = (err as { code?: string | number })?.code ?? null;
    const rawMessage = err instanceof Error ? err.message : null;
    const message =
      describeTwilioError(code, rawMessage) ?? "Failed to send SMS via Twilio";
    throw new TwilioServiceError(message);
  }
}

export async function createOutboundCall(params: {
  account: ITwilioAccount;
  from: string;
  to: string;
  sayText: string;
  voice?: string;
  statusCallbackUrl?: string;
}): Promise<{ sid: string }> {
  const { accountSid, authToken } = resolveCredentials(params.account);
  const client = twilio(accountSid, authToken);

  const twiml = buildOutboundSayTwiml(params.sayText, params.voice);

  try {
    const call = await client.calls.create({
      from: params.from,
      to: params.to,
      twiml,
      ...(params.statusCallbackUrl
        ? {
            statusCallback: params.statusCallbackUrl,
            statusCallbackEvent: [
              "initiated",
              "ringing",
              "answered",
              "completed",
            ],
            statusCallbackMethod: "POST",
          }
        : {}),
    });
    return { sid: call.sid };
  } catch (err) {
    const code = (err as { code?: string | number })?.code ?? null;
    const rawMessage = err instanceof Error ? err.message : null;
    const message =
      describeTwilioError(code, rawMessage) ?? "Failed to create Twilio call";
    throw new TwilioServiceError(message);
  }
}

/** Find a Twilio account whose auth token validates the webhook signature. */
export async function resolveAccountFromWebhook(params: {
  accountSidHint?: string | null;
  signature: string | undefined;
  url: string | string[];
  params: Record<string, string>;
}): Promise<ITwilioAccount | null> {
  const { validateRequest } = twilio;
  const candidates: ITwilioAccount[] = [];

  if (params.accountSidHint) {
    const bySid = await TwilioAccount.findOne({
      accountSid: params.accountSidHint,
    });
    if (bySid) candidates.push(bySid);
  }

  if (candidates.length === 0) {
    const all = await TwilioAccount.find({ isActive: true });
    candidates.push(...all);
  }

  if (!params.signature) return null;

  const urls = Array.isArray(params.url) ? params.url : [params.url];
  const uniqueUrls = [...new Set(urls.filter(Boolean))];

  for (const account of candidates) {
    try {
      const { authToken } = resolveCredentials(account);
      for (const url of uniqueUrls) {
        if (
          validateRequest(authToken, params.signature, url, params.params)
        ) {
          return account;
        }
      }
    } catch {
      // try next account
    }
  }

  return null;
}

function liveCredentials(account: ITwilioAccount): {
  accountSid: string;
  authToken: string;
} {
  return {
    accountSid: account.accountSid,
    authToken: resolveAuthToken(account),
  };
}

function webhookPath(path: string, accountSid?: string): string {
  if (!accountSid) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}accountSid=${encodeURIComponent(accountSid)}`;
}

function webhookAbsoluteUrl(path: string, accountSid?: string): string {
  const base = resolvePublicApiBase().replace(/\/+$/, "");
  return `${base}${webhookPath(path, accountSid)}`;
}

export function voiceWebhookAbsoluteUrl(accountSid?: string): string {
  return webhookAbsoluteUrl("/webhooks/twilio/voice", accountSid);
}

/** Same-host path for TwiML <Gather action> so callbacks follow the Voice webhook host. */
export function voiceGatherWebhookPath(accountSid?: string): string {
  return webhookPath("/webhooks/twilio/voice/gather", accountSid);
}

export function voiceGatherWebhookAbsoluteUrl(accountSid?: string): string {
  return webhookAbsoluteUrl("/webhooks/twilio/voice/gather", accountSid);
}

/** Same-host path for TwiML <Record action> so callbacks follow the Voice webhook host. */
export function voiceRecordingWebhookPath(accountSid?: string): string {
  return webhookPath("/webhooks/twilio/voice/recording", accountSid);
}

export function voiceRecordingWebhookAbsoluteUrl(accountSid?: string): string {
  return webhookAbsoluteUrl("/webhooks/twilio/voice/recording", accountSid);
}

export function messageWebhookAbsoluteUrl(accountSid?: string): string {
  return webhookAbsoluteUrl("/webhooks/twilio/message", accountSid);
}

export function statusWebhookAbsoluteUrl(accountSid?: string): string {
  return webhookAbsoluteUrl("/webhooks/twilio/status", accountSid);
}

/** Best-effort: Twilio sometimes delivers RecordingUrl before TranscriptionText. */
export async function fetchRecordingTranscript(
  account: ITwilioAccount,
  recordingSid: string,
): Promise<string> {
  const sid = recordingSid.trim();
  if (!sid) return "";
  try {
    const { accountSid, authToken } = liveCredentials(account);
    const client = twilio(accountSid, authToken);
    const list = await client.recordings(sid).transcriptions.list({ limit: 5 });
    const withText = list.find((t) => (t.transcriptionText || "").trim());
    return (withText?.transcriptionText || "").trim();
  } catch (err) {
    console.warn(
      `[twilio] Could not fetch transcription for recording ${sid}:`,
      err,
    );
    return "";
  }
}

/**
 * Point each configured incoming number at our Voice, SMS, and status URLs.
 * Uses live Account SID + Auth Token. Best-effort: missing numbers are skipped.
 */
export async function configureIncomingNumbersWebhooks(
  account: ITwilioAccount,
  urls: { voiceUrl: string; smsUrl: string; statusCallbackUrl: string },
): Promise<void> {
  const wanted = account.phoneNumbers ?? [];
  if (wanted.length === 0) return;

  const { accountSid, authToken } = liveCredentials(account);
  const client = twilio(accountSid, authToken);
  const incoming = await client.incomingPhoneNumbers.list({ limit: 200 });

  for (const raw of wanted) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) continue;
    const match = incoming.find((n) => {
      const d = (n.phoneNumber || "").replace(/\D/g, "");
      return (
        d === digits ||
        (d.length >= 7 && digits.length >= 7 && (d.endsWith(digits) || digits.endsWith(d)))
      );
    });
    if (!match) {
      console.warn(
        `[twilio] Incoming number ${raw} not found on account ${account.accountSid}; skipped webhook URL update`,
      );
      continue;
    }
    try {
      await client.incomingPhoneNumbers(match.sid).update({
        voiceUrl: urls.voiceUrl,
        voiceMethod: "POST",
        smsUrl: urls.smsUrl,
        smsMethod: "POST",
        statusCallback: urls.statusCallbackUrl,
        statusCallbackMethod: "POST",
      });
    } catch (err) {
      console.error(
        `[twilio] Failed to set webhook URLs on ${raw} (${match.sid}):`,
        err,
      );
    }
  }
}

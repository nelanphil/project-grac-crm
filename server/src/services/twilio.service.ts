import twilio from "twilio";
import { Types } from "mongoose";
import { TwilioAccount, ITwilioAccount } from "../models/mongo/TwilioAccount";
import { decryptCredential } from "../utils/credentialsCrypto";
import { describeTwilioError } from "../utils/twilioErrorCodes";
import { resolvePublicApiBase } from "../utils/publicUrl";

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

/**
 * Resolves the Account SID + Auth Token pair to use for real Twilio API calls.
 *
 * Twilio requires the Account SID and Auth Token to belong to the same
 * credential set — a live Account SID can never be authenticated with a Test
 * Auth Token (and vice versa), otherwise Twilio responds with a 401
 * "Authenticate" error (code 20003). Test credentials are only used when a
 * matching `testAccountSid` + `testAuthTokenEncrypted` pair is fully
 * configured for the account; otherwise we always fall back to the live
 * pair so sending never silently breaks.
 */
function resolveCredentials(account: ITwilioAccount): {
  accountSid: string;
  authToken: string;
} {
  const useTest =
    process.env.NODE_ENV !== "production" &&
    Boolean(account.testAccountSid) &&
    Boolean(account.testAuthTokenEncrypted);

  if (useTest) {
    return {
      accountSid: account.testAccountSid!,
      authToken: decryptCredential(account.testAuthTokenEncrypted!),
    };
  }

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
  statusCallbackUrl?: string;
}): Promise<{ sid: string }> {
  const { accountSid, authToken } = resolveCredentials(params.account);
  const client = twilio(accountSid, authToken);

  const escaped = params.sayText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const twiml = `<Response><Say voice="alice">${escaped}</Say></Response>`;

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
  url: string;
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

  for (const account of candidates) {
    try {
      const { authToken } = resolveCredentials(account);
      if (
        validateRequest(authToken, params.signature, params.url, params.params)
      ) {
        return account;
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

function webhookAbsoluteUrl(path: string, accountSid?: string): string {
  const base = resolvePublicApiBase().replace(/\/+$/, "");
  const url = `${base}${path}`;
  if (!accountSid) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}accountSid=${encodeURIComponent(accountSid)}`;
}

export function voiceWebhookAbsoluteUrl(accountSid?: string): string {
  return webhookAbsoluteUrl("/webhooks/twilio/voice", accountSid);
}

export function voiceRecordingWebhookAbsoluteUrl(accountSid?: string): string {
  return webhookAbsoluteUrl("/webhooks/twilio/voice/recording", accountSid);
}

/**
 * Point each configured incoming number's Voice webhook at our TwiML URL.
 * Uses live Account SID + Auth Token (not test credentials). Best-effort:
 * missing numbers are skipped and logged.
 */
export async function configureIncomingNumbersVoiceUrl(
  account: ITwilioAccount,
  voiceUrl: string,
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
        `[twilio] Incoming number ${raw} not found on account ${account.accountSid}; skipped Voice URL update`,
      );
      continue;
    }
    try {
      await client.incomingPhoneNumbers(match.sid).update({
        voiceUrl,
        voiceMethod: "POST",
      });
    } catch (err) {
      console.error(
        `[twilio] Failed to set Voice URL on ${raw} (${match.sid}):`,
        err,
      );
    }
  }
}

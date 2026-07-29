import twilio from "twilio";
import { Types } from "mongoose";
import { TwilioAccount, ITwilioAccount } from "../models/mongo/TwilioAccount";
import { decryptCredential } from "../utils/credentialsCrypto";

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
    });
    return { sid: message.sid };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to send SMS via Twilio";
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
    const message =
      err instanceof Error ? err.message : "Failed to create Twilio call";
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

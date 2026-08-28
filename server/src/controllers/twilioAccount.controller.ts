import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { TwilioAccount, ITwilioAccount } from "../models/mongo/TwilioAccount";
import {
  createTwilioAccountSchema,
  updateTwilioAccountSchema,
} from "../schemas/twilioAccount.schema";
import { encryptCredential } from "../utils/credentialsCrypto";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  configureIncomingNumbersVoiceUrl,
  isLiveTwilioDisabled,
  voiceWebhookAbsoluteUrl,
} from "../services/twilio.service";
import { isPubliclyReachableApiHost } from "../utils/publicUrl";

async function applyVoiceWebhooks(account: ITwilioAccount): Promise<void> {
  if (!account.phoneNumbers?.length) return;

  const voiceUrl = voiceWebhookAbsoluteUrl(account.accountSid);
  if (isLiveTwilioDisabled() || !isPubliclyReachableApiHost(voiceUrl)) {
    console.info(
      `[twilio] Skipping Voice URL push for ${account.friendlyName} (non-production or non-public webhook URL)`,
    );
    return;
  }

  try {
    await configureIncomingNumbersVoiceUrl(account, voiceUrl);
  } catch (err) {
    console.error(
      `Failed to set Twilio Voice URLs for ${account.friendlyName}:`,
      err,
    );
  }
}

function emptyToUndefined(
  value: string | undefined | null,
): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function toPublic(doc: ITwilioAccount | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as ITwilioAccount).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    accountSid: d.accountSid,
    friendlyName: d.friendlyName,
    phoneNumbers: d.phoneNumbers ?? [],
    isActive: d.isActive ?? true,
    hasAuthToken: Boolean(d.authTokenEncrypted),
    testAccountSid: d.testAccountSid ?? null,
    hasTestAuthToken: Boolean(d.testAuthTokenEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getTwilioAccounts(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const accounts = await TwilioAccount.find().sort({ friendlyName: 1 }).lean();
  res.json({ accounts: accounts.map(toPublic) });
}

export async function createTwilioAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = createTwilioAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const existing = await TwilioAccount.findOne({ accountSid: data.accountSid });
  if (existing) {
    res.status(409).json({
      message: "A Twilio account with this Account SID already exists",
    });
    return;
  }

  const testAuthToken = emptyToUndefined(data.testAuthToken);
  const testAccountSid = emptyToUndefined(data.testAccountSid);

  const account = await TwilioAccount.create({
    accountSid: data.accountSid,
    friendlyName: data.friendlyName,
    authTokenEncrypted: encryptCredential(data.authToken),
    testAccountSid,
    testAuthTokenEncrypted: testAuthToken
      ? encryptCredential(testAuthToken)
      : undefined,
    phoneNumbers: data.phoneNumbers ?? [],
    isActive: data.isActive ?? true,
  });

  logNotificationAsync({
    entityType: "twilio_account",
    action: "created",
    entityId: String(account._id),
    summary: `Twilio account ${data.friendlyName} created`,
    metadata: { friendlyName: data.friendlyName },
    ...actorFromRequest(req.user),
  });

  await applyVoiceWebhooks(account);

  res.status(201).json({ account: toPublic(account) });
}

export async function updateTwilioAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = updateTwilioAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const account = await TwilioAccount.findById(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Twilio account not found" });
    return;
  }

  const data = parsed.data;

  if (data.accountSid && data.accountSid !== account.accountSid) {
    const conflict = await TwilioAccount.findOne({
      accountSid: data.accountSid,
    });
    if (conflict) {
      res.status(409).json({
        message: "A Twilio account with this Account SID already exists",
      });
      return;
    }
    account.accountSid = data.accountSid;
  }

  if (data.friendlyName !== undefined) {
    account.friendlyName = data.friendlyName;
  }

  const authToken = emptyToUndefined(data.authToken);
  if (authToken) {
    account.authTokenEncrypted = encryptCredential(authToken);
  }

  // testAuthToken: string = set new value, null = explicitly clear, undefined = leave unchanged
  if (data.testAuthToken === null) {
    account.testAuthTokenEncrypted = undefined;
  } else {
    const testAuthToken = emptyToUndefined(data.testAuthToken);
    if (testAuthToken) {
      account.testAuthTokenEncrypted = encryptCredential(testAuthToken);
    }
  }

  // testAccountSid: string = set new value, null = explicitly clear, undefined = leave unchanged
  if (data.testAccountSid === null) {
    account.testAccountSid = undefined;
  } else if (data.testAccountSid !== undefined) {
    account.testAccountSid = emptyToUndefined(data.testAccountSid);
  }

  if (data.phoneNumbers !== undefined) {
    account.phoneNumbers = data.phoneNumbers;
  }

  if (data.isActive !== undefined) {
    account.isActive = data.isActive;
  }

  await account.save();

  if (data.phoneNumbers !== undefined) {
    await applyVoiceWebhooks(account);
  }

  logNotificationAsync({
    entityType: "twilio_account",
    action: "updated",
    entityId: String(account._id),
    summary: `Twilio account ${account.friendlyName} updated`,
    metadata: { friendlyName: account.friendlyName },
    ...actorFromRequest(req.user),
  });

  res.json({ account: toPublic(account) });
}

export async function deleteTwilioAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const account = await TwilioAccount.findByIdAndDelete(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Twilio account not found" });
    return;
  }

  logNotificationAsync({
    entityType: "twilio_account",
    action: "deleted",
    entityId: String(account._id),
    summary: `Twilio account ${account.friendlyName} deleted`,
    metadata: { friendlyName: account.friendlyName },
    ...actorFromRequest(req.user),
  });

  res.json({ message: "Twilio account deleted" });
}

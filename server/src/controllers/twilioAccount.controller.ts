import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  ensureTwilioPhoneLineShape,
  ITwilioAccount,
  TwilioAccount,
} from "../models/mongo/TwilioAccount";
import {
  createTwilioAccountSchema,
  enableBrowserCallingSchema,
  previewTwilioNumbersSchema,
  updateTwilioAccountSchema,
} from "../schemas/twilioAccount.schema";
import { readCurrentNgrokBase } from "../services/devTunnel.service";
import { ensureVoiceIntelligenceService } from "../services/callTranscription.service";
import { encryptCredential } from "../utils/credentialsCrypto";
import twilio from "twilio";
import {
  isPubliclyReachableApiHost,
  resolvePublicApiBase,
  resolveVoiceWebhookBase,
} from "../utils/publicUrl";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  configureIncomingNumbersWebhooks,
  getAccountAuthToken,
  getTwilioCredentialPair,
  getTwilioRuntimeEnvironment,
  listIncomingPhoneNumbers,
  messageWebhookAbsoluteUrl,
  statusWebhookAbsoluteUrl,
  syncAccountPhoneLines,
  voiceWebhookAbsoluteUrl,
} from "../services/twilio.service";
import { DEFAULT_SAY_VOICE, resolveSayVoice } from "../utils/twilioVoices";
import {
  applySubmittedLabels,
  normalizePhoneLines,
  TwilioPhoneLineLabelInput,
} from "../utils/twilioPhoneLines";

async function applyNumberWebhooks(account: ITwilioAccount): Promise<void> {
  if (!normalizePhoneLines(account.phoneNumbers).length) return;

  const voiceUrl = voiceWebhookAbsoluteUrl(account.accountSid);
  if (!isPubliclyReachableApiHost(voiceUrl)) {
    console.info(
      `[twilio] Skipping webhook URL push for ${account.friendlyName} (non-public webhook URL)`,
    );
    return;
  }

  try {
    await configureIncomingNumbersWebhooks(account, {
      voiceUrl,
      smsUrl: messageWebhookAbsoluteUrl(account.accountSid),
      statusCallbackUrl: statusWebhookAbsoluteUrl(account.accountSid),
    });
  } catch (err) {
    console.error(
      `Failed to set Twilio webhook URLs for ${account.friendlyName}:`,
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
    phoneNumbers: normalizePhoneLines(d.phoneNumbers),
    isActive: d.isActive ?? true,
    sayVoice: resolveSayVoice(
      typeof d.sayVoice === "string" ? d.sayVoice : DEFAULT_SAY_VOICE,
    ),
    environment: getTwilioRuntimeEnvironment(),
    credentialsInUse: getTwilioCredentialPair(),
    hasAuthToken: Boolean(d.authTokenEncrypted),
    testAccountSid: d.testAccountSid ?? null,
    hasTestAuthToken: Boolean(d.testAuthTokenEncrypted),
    browserCalling: Boolean(
      d.voiceApiKeySid && d.voiceApiKeySecretEncrypted && d.voiceTwimlAppSid,
    ),
    voicePublicBaseUrl:
      typeof d.voicePublicBaseUrl === "string" ? d.voicePublicBaseUrl : "",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getTwilioAccounts(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  await ensureTwilioPhoneLineShape();
  const accounts = await TwilioAccount.find().sort({ friendlyName: 1 }).lean();
  res.json({ accounts: accounts.map(toPublic) });
}

export async function previewTwilioNumbers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = previewTwilioNumbersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const incoming = await listIncomingPhoneNumbers(
      parsed.data.accountSid,
      parsed.data.authToken,
    );
    res.json({
      phoneNumbers: incoming.map((number) => ({
        phoneNumber: number.phoneNumber,
        label: "",
        twilioFriendlyName: number.friendlyName,
        incomingSid: number.sid,
        sms: number.sms,
        mms: number.mms,
        voice: number.voice,
      })),
    });
  } catch (err) {
    res.status(400).json({
      message:
        err instanceof Error
          ? err.message
          : "Failed to load phone numbers from Twilio",
    });
  }
}

export async function createTwilioAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  await ensureTwilioPhoneLineShape();
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
    phoneNumbers: [],
    isActive: data.isActive ?? true,
    sayVoice: resolveSayVoice(data.sayVoice),
  });

  const sync = await syncAccountPhoneLines(account, data.phoneNumbers);
  await account.save();

  logNotificationAsync({
    entityType: "twilio_account",
    action: "created",
    entityId: String(account._id),
    summary: `Twilio account ${data.friendlyName} created`,
    metadata: { friendlyName: data.friendlyName },
    ...actorFromRequest(req.user),
  });

  if (!sync.error) await applyNumberWebhooks(account);

  res.status(201).json({
    account: toPublic(account),
    numbersSyncError: sync.error,
  });
}

export async function updateTwilioAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  await ensureTwilioPhoneLineShape();
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
  const credentialsChanged = Boolean(
    emptyToUndefined(data.authToken) ||
      (data.accountSid && data.accountSid !== account.accountSid),
  );

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

  if (data.phoneNumbers !== undefined && !credentialsChanged) {
    account.phoneNumbers = applySubmittedLabels(
      account.phoneNumbers,
      data.phoneNumbers,
    );
  }

  if (data.isActive !== undefined) {
    account.isActive = data.isActive;
  }

  if (data.sayVoice !== undefined) {
    account.sayVoice = resolveSayVoice(data.sayVoice);
  }

  let numbersSyncError: string | null = null;
  if (credentialsChanged) {
    const sync = await syncAccountPhoneLines(
      account,
      data.phoneNumbers as TwilioPhoneLineLabelInput[] | undefined,
    );
    numbersSyncError = sync.error;
  }

  await account.save();

  if (credentialsChanged && !numbersSyncError) {
    await applyNumberWebhooks(account);
  }

  logNotificationAsync({
    entityType: "twilio_account",
    action: "updated",
    entityId: String(account._id),
    summary: `Twilio account ${account.friendlyName} updated`,
    metadata: { friendlyName: account.friendlyName },
    ...actorFromRequest(req.user),
  });

  res.json({ account: toPublic(account), numbersSyncError });
}

export async function syncTwilioAccountNumbers(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  await ensureTwilioPhoneLineShape();
  const account = await TwilioAccount.findById(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Twilio account not found" });
    return;
  }

  const sync = await syncAccountPhoneLines(account);
  await account.save();
  if (!sync.error) await applyNumberWebhooks(account);

  res.json({ account: toPublic(account), numbersSyncError: sync.error });
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

export async function enableBrowserCalling(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  await ensureTwilioPhoneLineShape();
  const account = await TwilioAccount.findById(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Twilio account not found" });
    return;
  }

  const detected = resolvePublicApiBase(req);
  const development = process.env.NODE_ENV !== "production";
  const parsed = enableBrowserCallingSchema.safeParse(req.body ?? {});
  const requested = development && parsed.success ? parsed.data.publicApiUrl : "";
  const ngrokBase = development ? await readCurrentNgrokBase() : null;
  const base = resolveVoiceWebhookBase(
    detected,
    development ? requested || ngrokBase || account.voicePublicBaseUrl : "",
  );
  if (!base) {
    res.status(400).json({
      message:
        process.env.NODE_ENV === "production"
          ? "Browser calling needs a public PUBLIC_API_URL so Twilio can reach the voice webhook."
          : "Start ngrok for this API, or paste a public tunnel URL, then enable browser calling.",
    });
    return;
  }

  const voiceUrl = `${base}/webhooks/twilio/voice/client?accountSid=${encodeURIComponent(account.accountSid)}`;

  try {
    const client = twilio(account.accountSid, getAccountAuthToken(account));
    if (account.voiceTwimlAppSid) {
      await client.applications(account.voiceTwimlAppSid).update({
        voiceUrl,
        voiceMethod: "POST",
      });
    } else {
      const app = await client.applications.create({
        friendlyName: "GRAC browser calling",
        voiceUrl,
        voiceMethod: "POST",
      });
      account.voiceTwimlAppSid = app.sid;
    }

    if (!account.voiceApiKeySid || !account.voiceApiKeySecretEncrypted) {
      const key = await client.newKeys.create({
        friendlyName: "GRAC browser calling",
      });
      account.voiceApiKeySid = key.sid;
      account.voiceApiKeySecretEncrypted = encryptCredential(key.secret);
    }

    account.voicePublicBaseUrl = base;
    try {
      await ensureVoiceIntelligenceService(account, base);
    } catch (err) {
      console.warn(
        "[voice] could not prepare call transcription:",
        err instanceof Error ? err.message : err,
      );
    }
    await account.save();
    res.json({ account: toPublic(account) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enable browser calling";
    res.status(400).json({ message });
  }
}

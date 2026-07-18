import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { TwilioAccount, ITwilioAccount } from "../models/mongo/TwilioAccount";
import {
  createTwilioAccountSchema,
  updateTwilioAccountSchema,
} from "../schemas/twilioAccount.schema";
import { encryptCredential } from "../utils/credentialsCrypto";

function emptyToUndefined(value: string | undefined | null): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function toPublic(doc: ITwilioAccount | Record<string, unknown>) {
  const d = "toObject" in doc && typeof doc.toObject === "function"
    ? (doc as ITwilioAccount).toObject()
    : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    accountSid: d.accountSid,
    friendlyName: d.friendlyName,
    phoneNumbers: d.phoneNumbers ?? [],
    isActive: d.isActive ?? true,
    hasAuthToken: Boolean(d.authTokenEncrypted),
    hasTestAuthToken: Boolean(d.testAuthTokenEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getTwilioAccounts(
  _req: AuthRequest,
  res: Response
): Promise<void> {
  const accounts = await TwilioAccount.find().sort({ friendlyName: 1 }).lean();
  res.json({ accounts: accounts.map(toPublic) });
}

export async function createTwilioAccount(
  req: AuthRequest,
  res: Response
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
    res.status(409).json({ message: "A Twilio account with this Account SID already exists" });
    return;
  }

  const testAuthToken = emptyToUndefined(data.testAuthToken);

  const account = await TwilioAccount.create({
    accountSid: data.accountSid,
    friendlyName: data.friendlyName,
    authTokenEncrypted: encryptCredential(data.authToken),
    testAuthTokenEncrypted: testAuthToken ? encryptCredential(testAuthToken) : undefined,
    phoneNumbers: data.phoneNumbers ?? [],
    isActive: data.isActive ?? true,
  });

  res.status(201).json({ account: toPublic(account) });
}

export async function updateTwilioAccount(
  req: AuthRequest,
  res: Response
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
    const conflict = await TwilioAccount.findOne({ accountSid: data.accountSid });
    if (conflict) {
      res.status(409).json({ message: "A Twilio account with this Account SID already exists" });
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

  const testAuthToken = emptyToUndefined(data.testAuthToken);
  if (testAuthToken) {
    account.testAuthTokenEncrypted = encryptCredential(testAuthToken);
  }

  if (data.phoneNumbers !== undefined) {
    account.phoneNumbers = data.phoneNumbers;
  }

  if (data.isActive !== undefined) {
    account.isActive = data.isActive;
  }

  await account.save();
  res.json({ account: toPublic(account) });
}

export async function deleteTwilioAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const account = await TwilioAccount.findByIdAndDelete(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Twilio account not found" });
    return;
  }
  res.json({ message: "Twilio account deleted" });
}

import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { QuoCredentials, IQuoCredentials } from "../models/mongo/QuoCredentials";
import { quoCredentialsSchema } from "../schemas/quoCredentials.schema";
import {
  decryptCredential,
  encryptCredential,
} from "../utils/credentialsCrypto";

function emptyToUndefined(
  value: string | undefined | null,
): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function toPublic(doc: IQuoCredentials | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IQuoCredentials).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    label: d.label ?? "",
    isActive: d.isActive ?? true,
    hasApiKey: Boolean(d.apiKeyEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getQuoCredentials(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const doc = await QuoCredentials.findOne().lean();
  res.json({ credentials: doc ? toPublic(doc) : null });
}

export async function saveQuoCredentials(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = quoCredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const apiKey = emptyToUndefined(data.apiKey);
  const label = emptyToUndefined(data.label);

  let doc = await QuoCredentials.findOne();

  if (!doc && !apiKey) {
    res.status(400).json({ message: "API key is required" });
    return;
  }

  if (!doc) {
    doc = new QuoCredentials({
      apiKeyEncrypted: encryptCredential(apiKey!),
      label,
      isActive: data.isActive ?? true,
    });
  } else {
    if (apiKey) doc.apiKeyEncrypted = encryptCredential(apiKey);
    if (data.label !== undefined) doc.label = label;
    if (data.isActive !== undefined) doc.isActive = data.isActive;
  }

  await doc.save();
  res.json({ credentials: toPublic(doc) });
}

export async function deleteQuoCredentials(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const result = await QuoCredentials.findOneAndDelete();
  if (!result) {
    res.status(404).json({ message: "Quo credentials not found" });
    return;
  }

  res.json({ message: "Quo credentials deleted" });
}

export async function getQuoApiKey(): Promise<string | null> {
  const doc = await QuoCredentials.findOne({ isActive: true }).lean();
  if (!doc?.apiKeyEncrypted) return null;

  try {
    return decryptCredential(String(doc.apiKeyEncrypted));
  } catch {
    return null;
  }
}

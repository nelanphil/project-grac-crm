import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  CloudinaryCredentials,
  ICloudinaryCredentials,
} from "../models/mongo/CloudinaryCredentials";
import { cloudinaryCredentialsSchema } from "../schemas/cloudinaryCredentials.schema";
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

function toPublic(doc: ICloudinaryCredentials | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as ICloudinaryCredentials).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    cloudName: d.cloudName,
    uploadPreset: d.uploadPreset ?? "",
    isActive: d.isActive ?? true,
    hasApiKey: Boolean(d.apiKeyEncrypted),
    hasApiSecret: Boolean(d.apiSecretEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getCloudinaryCredentials(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const doc = await CloudinaryCredentials.findOne().lean();
  res.json({ credentials: doc ? toPublic(doc) : null });
}

export async function saveCloudinaryCredentials(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = cloudinaryCredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const cloudName = emptyToUndefined(data.cloudName);
  const apiKey = emptyToUndefined(data.apiKey);
  const apiSecret = emptyToUndefined(data.apiSecret);
  const uploadPreset = emptyToUndefined(data.uploadPreset);

  let doc = await CloudinaryCredentials.findOne();

  if (!doc && (!cloudName || !apiKey || !apiSecret)) {
    res
      .status(400)
      .json({ message: "Cloud name, API key, and API secret are required" });
    return;
  }

  if (!doc) {
    doc = new CloudinaryCredentials({
      cloudName: cloudName!,
      apiKeyEncrypted: encryptCredential(apiKey!),
      apiSecretEncrypted: encryptCredential(apiSecret!),
      uploadPreset,
      isActive: data.isActive ?? true,
    });
  } else {
    if (cloudName) doc.cloudName = cloudName;
    if (apiKey) doc.apiKeyEncrypted = encryptCredential(apiKey);
    if (apiSecret) doc.apiSecretEncrypted = encryptCredential(apiSecret);
    // Use raw field presence (not the empty-to-undefined value) so submitting a blank preset clears it.
    if (data.uploadPreset !== undefined) doc.uploadPreset = uploadPreset;
    if (data.isActive !== undefined) doc.isActive = data.isActive;
  }

  await doc.save();
  res.json({ credentials: toPublic(doc) });
}

export async function deleteCloudinaryCredentials(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const result = await CloudinaryCredentials.findOneAndDelete();
  if (!result) {
    res.status(404).json({ message: "Cloudinary credentials not found" });
    return;
  }

  res.json({ message: "Cloudinary credentials deleted" });
}

export async function getCloudinarySecretsForUpload(): Promise<{
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  uploadPreset?: string;
} | null> {
  const doc = await CloudinaryCredentials.findOne({ isActive: true }).lean();
  if (!doc) return null;

  try {
    return {
      cloudName: String(doc.cloudName).trim(),
      apiKey: decryptCredential(String(doc.apiKeyEncrypted)),
      apiSecret: decryptCredential(String(doc.apiSecretEncrypted)),
      uploadPreset: doc.uploadPreset || undefined,
    };
  } catch {
    return null;
  }
}

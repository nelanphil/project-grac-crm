import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { GoogleCredentials, IGoogleCredentials } from "../models/mongo/GoogleCredentials";
import { saveGoogleCredentialsSchema } from "../schemas/googleCredentials.schema";
import { encryptCredential } from "../utils/credentialsCrypto";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";

const SLUG = "google";

function emptyToUndefined(value: string | undefined | null): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function toPublic(doc: IGoogleCredentials | Record<string, unknown>) {
  const d = "toObject" in doc && typeof doc.toObject === "function"
    ? (doc as IGoogleCredentials).toObject()
    : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    label: d.label,
    projectId: d.projectId ?? "",
    isActive: d.isActive ?? true,
    hasApiKey: Boolean(d.apiKeyEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getGoogleCredentials(
  _req: AuthRequest,
  res: Response
): Promise<void> {
  const doc = await GoogleCredentials.findOne({ slug: SLUG }).lean();
  res.json({ credentials: doc ? toPublic(doc) : null });
}

export async function saveGoogleCredentials(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const parsed = saveGoogleCredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const apiKey = emptyToUndefined(data.apiKey);

  let doc = await GoogleCredentials.findOne({ slug: SLUG });

  if (!doc && !apiKey) {
    res.status(400).json({ message: "API key is required" });
    return;
  }

  if (!doc) {
    doc = new GoogleCredentials({
      slug: SLUG,
      label: data.label?.trim() || "Google Address Validation API",
      apiKeyEncrypted: encryptCredential(apiKey!),
      projectId: emptyToUndefined(data.projectId),
      isActive: data.isActive ?? true,
    });
  } else {
    if (data.label !== undefined) doc.label = data.label.trim();
    if (apiKey) doc.apiKeyEncrypted = encryptCredential(apiKey);
    if (data.projectId !== undefined) {
      doc.projectId = emptyToUndefined(data.projectId);
    }
    if (data.isActive !== undefined) doc.isActive = data.isActive;
  }

  await doc.save();

  logNotificationAsync({
    entityType: "google_credentials",
    action: "updated",
    entityId: String(doc._id),
    summary: "Google credentials updated",
    metadata: { label: doc.label },
    ...actorFromRequest(req.user),
  });

  res.json({ credentials: toPublic(doc) });
}

export async function deleteGoogleCredentials(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const doc = await GoogleCredentials.findOneAndDelete({ slug: SLUG });
  if (!doc) {
    res.status(404).json({ message: "Google credentials not found" });
    return;
  }

  logNotificationAsync({
    entityType: "google_credentials",
    action: "deleted",
    entityId: String(doc._id),
    summary: "Google credentials deleted",
    ...actorFromRequest(req.user),
  });

  res.json({ message: "Google credentials deleted" });
}

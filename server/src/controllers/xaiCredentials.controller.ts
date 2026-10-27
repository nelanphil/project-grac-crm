import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  DEFAULT_GROK_MODEL,
  IXaiCredentials,
  XaiCredentials,
} from "../models/mongo/XaiCredentials";
import { xaiCredentialsSchema } from "../schemas/xaiCredentials.schema";
import { decryptCredential, encryptCredential } from "../utils/credentialsCrypto";
import { listXaiLanguageModels, testXaiKey } from "../services/grokCallSummary.service";

function toPublic(doc: IXaiCredentials | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IXaiCredentials).toObject()
      : (doc as Record<string, unknown>);
  return {
    _id: d._id,
    model: typeof d.modelName === "string" && d.modelName ? d.modelName : DEFAULT_GROK_MODEL,
    isActive: d.isActive ?? true,
    hasApiKey: Boolean(d.apiKeyEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getXaiCredentials(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const doc = await XaiCredentials.findOne().lean();
  res.json({ credentials: doc ? toPublic(doc) : null });
}

export async function saveXaiCredentials(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = xaiCredentialsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const apiKey = parsed.data.apiKey.trim();
  const model = parsed.data.model.trim() || DEFAULT_GROK_MODEL;
  let doc = await XaiCredentials.findOne();
  if (!doc && !apiKey) {
    res.status(400).json({ message: "An API key is required the first time." });
    return;
  }
  if (!doc) {
    doc = new XaiCredentials({
      apiKeyEncrypted: encryptCredential(apiKey),
      modelName: model,
      isActive: parsed.data.isActive,
    });
  } else {
    if (apiKey) doc.apiKeyEncrypted = encryptCredential(apiKey);
    doc.modelName = model;
    doc.isActive = parsed.data.isActive;
  }
  await doc.save();
  res.json({ credentials: toPublic(doc) });
}

export async function deleteXaiCredentials(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const result = await XaiCredentials.findOneAndDelete();
  if (!result) {
    res.status(404).json({ message: "xAI credentials not found" });
    return;
  }
  res.json({ message: "xAI credentials deleted" });
}

async function resolveApiKey(submitted: string): Promise<string | null> {
  if (submitted) return submitted;
  const doc = await XaiCredentials.findOne().lean();
  if (!doc?.apiKeyEncrypted) return null;
  return decryptCredential(String(doc.apiKeyEncrypted));
}

export async function listXaiModels(req: AuthRequest, res: Response): Promise<void> {
  const submitted = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const apiKey = await resolveApiKey(submitted);
  if (!apiKey) {
    res.status(400).json({ message: "Save an API key before loading models." });
    return;
  }
  try {
    const models = await listXaiLanguageModels(apiKey);
    res.json({ models });
  } catch (err) {
    res.status(400).json({
      message: err instanceof Error ? err.message : "xAI could not list models",
    });
  }
}

export async function testXaiCredentials(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const submitted = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const model =
    typeof req.body?.model === "string" && req.body.model.trim()
      ? req.body.model.trim()
      : DEFAULT_GROK_MODEL;
  const apiKey = await resolveApiKey(submitted);
  if (!apiKey) {
    res.status(400).json({ message: "Save an API key before testing." });
    return;
  }
  try {
    const reply = await testXaiKey(apiKey, model);
    res.json({ ok: true, message: reply.slice(0, 80) || "ok" });
  } catch (err) {
    res.status(400).json({
      message: err instanceof Error ? err.message : "xAI rejected the key",
    });
  }
}

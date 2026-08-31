import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  IRecaptchaCredentials,
  RECAPTCHA_SLUG,
  RecaptchaCredentials,
} from "../models/mongo/RecaptchaCredentials";
import { saveRecaptchaCredentialsSchema } from "../schemas/recaptchaCredentials.schema";
import { encryptCredential } from "../utils/credentialsCrypto";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";

function emptyToUndefined(
  value: string | undefined | null,
): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function toPublic(doc: IRecaptchaCredentials | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IRecaptchaCredentials).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    siteKey: d.siteKey ?? "",
    version: d.version === "v3" ? "v3" : "v2",
    minScore: typeof d.minScore === "number" ? d.minScore : 0.5,
    isActive: d.isActive ?? true,
    hasSecretKey: Boolean(d.secretKeyEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getRecaptchaCredentials(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const doc = await RecaptchaCredentials.findOne({
      slug: RECAPTCHA_SLUG,
    }).lean();
    res.json({ credentials: doc ? toPublic(doc) : null });
  } catch (err) {
    console.error("GET /recaptcha-credentials error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/** Public: site key for the contact-form widget. Secret is never returned. */
export async function getRecaptchaSiteKey(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const doc = await RecaptchaCredentials.findOne({
      slug: RECAPTCHA_SLUG,
      isActive: true,
    }).lean();
    if (!doc?.siteKey || !doc.secretKeyEncrypted) {
      res.json({ siteKey: null, version: "v2" as const });
      return;
    }
    res.json({
      siteKey: doc.siteKey,
      version: doc.version === "v3" ? ("v3" as const) : ("v2" as const),
    });
  } catch (err) {
    console.error("GET /recaptcha-credentials/site-key error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function saveRecaptchaCredentials(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = saveRecaptchaCredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const siteKey = emptyToUndefined(data.siteKey);
  const secretKey = emptyToUndefined(data.secretKey);

  try {
    let doc = await RecaptchaCredentials.findOne({ slug: RECAPTCHA_SLUG });

    if (!doc && (!siteKey || !secretKey)) {
      res
        .status(400)
        .json({ message: "Site key and secret key are required" });
      return;
    }

    if (!doc) {
      doc = new RecaptchaCredentials({
        slug: RECAPTCHA_SLUG,
        siteKey: siteKey!,
        secretKeyEncrypted: encryptCredential(secretKey!),
        version: data.version ?? "v2",
        minScore: data.minScore ?? 0.5,
        isActive: data.isActive ?? true,
      });
    } else {
      if (siteKey) doc.siteKey = siteKey;
      if (secretKey) doc.secretKeyEncrypted = encryptCredential(secretKey);
      if (data.version !== undefined) doc.version = data.version;
      if (data.minScore !== undefined) doc.minScore = data.minScore;
      if (data.isActive !== undefined) doc.isActive = data.isActive;
    }

    await doc.save();

    logNotificationAsync({
      entityType: "recaptcha_credentials",
      action: "updated",
      entityId: String(doc._id),
      summary: "reCAPTCHA credentials updated",
      metadata: { version: doc.version },
      ...actorFromRequest(req.user),
    });

    res.json({ credentials: toPublic(doc) });
  } catch (err) {
    console.error("PUT /recaptcha-credentials error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteRecaptchaCredentials(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const doc = await RecaptchaCredentials.findOneAndDelete({
      slug: RECAPTCHA_SLUG,
    });
    if (!doc) {
      res.status(404).json({ message: "reCAPTCHA credentials not found" });
      return;
    }

    logNotificationAsync({
      entityType: "recaptcha_credentials",
      action: "deleted",
      entityId: String(doc._id),
      summary: "reCAPTCHA credentials deleted",
      ...actorFromRequest(req.user),
    });

    res.json({ message: "reCAPTCHA credentials deleted" });
  } catch (err) {
    console.error("DELETE /recaptcha-credentials error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

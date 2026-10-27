import crypto from "crypto";
import { NextFunction, Response } from "express";
import multer from "multer";
import { AuthRequest } from "../middleware/auth.middleware";
import { getCloudinarySecretsForUpload } from "./cloudinaryCredentials.controller";

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

const MEDIA_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "application/pdf",
  "text/vcard",
  "text/x-vcard",
]);

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEDIA_BYTES },
});

function mediaAllowed(file: Express.Multer.File): boolean {
  if (MEDIA_MIME_TYPES.has(file.mimetype)) return true;
  if (file.mimetype && file.mimetype !== "application/octet-stream") return false;
  return /\.(jpe?g|png|gif|webp|mp4|pdf|vcf)$/i.test(file.originalname || "");
}

function resourceType(mime: string): "image" | "video" | "raw" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "raw";
}

function fileName(file: Express.Multer.File): string {
  const base = (file.originalname || "attachment").split(/[/\\]/).pop() || "attachment";
  return base.slice(0, 180) || "attachment";
}

export function uploadInboxMediaMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  mediaUpload.single("file")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const limit =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "LIMIT_FILE_SIZE";
    res.status(400).json({
      message: limit
        ? "Files must be 5 MB or smaller."
        : err instanceof Error
          ? err.message
          : "Upload failed.",
    });
  });
}

export async function uploadInboxMedia(req: AuthRequest, res: Response): Promise<void> {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ message: "A file upload is required." });
      return;
    }
    if (!mediaAllowed(file)) {
      res.status(400).json({
        message: "Attach a photo, MP4, PDF, or contact card.",
      });
      return;
    }

    const config = await getCloudinarySecretsForUpload();
    if (!config) {
      res.status(400).json({
        message: "Cloudinary credentials are required before attaching files.",
      });
      return;
    }

    const id = crypto.randomBytes(12).toString("hex");
    const kind = resourceType(file.mimetype || "");
    const body = new FormData();
    body.append(
      "file",
      new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }),
      fileName(file),
    );
    if (config.uploadPreset) body.append("upload_preset", config.uploadPreset);
    body.append("public_id", id);
    body.append("folder", "inbox-mms");
    body.append("tags", "inbox-mms");

    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/${kind}/upload`;
    const response = await fetch(cloudinaryUrl, {
      method: "POST",
      body,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`,
      },
    });
    const data = (await response.json().catch(() => ({}))) as {
      secure_url?: string;
      error?: { message?: string };
    };
    if (!response.ok || !data.secure_url || !data.secure_url.startsWith("https://")) {
      res.status(502).json({
        message: data.error?.message || "File upload failed.",
      });
      return;
    }

    res.status(201).json({
      url: data.secure_url,
      mimeType: file.mimetype || "",
      size: file.size,
      name: fileName(file),
    });
  } catch (err) {
    console.error("POST /inboxes/media error:", err);
    res.status(500).json({ message: "Failed to upload the file" });
  }
}

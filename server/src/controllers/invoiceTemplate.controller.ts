import crypto from "crypto";
import { NextFunction, Response } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  InvoiceTemplate,
  IInvoiceTemplate,
  ensureDefaultInvoiceTemplate,
} from "../models/mongo/InvoiceTemplate";
import {
  createInvoiceTemplateSchema,
  invoiceBlocksSchema,
  sanitizeInvoiceBlocks,
  updateInvoiceTemplateSchema,
} from "../schemas/invoiceTemplate.schema";
import { defaultInvoiceBlocks } from "../utils/defaultInvoiceBlocks";
import { getCloudinarySecretsForUpload } from "./cloudinaryCredentials.controller";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
});

function toPublic(doc: IInvoiceTemplate | Record<string, unknown>) {
  const row =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IInvoiceTemplate).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: row._id,
    name: row.name,
    isDefault: Boolean(row.isDefault),
    blocks: row.blocks ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

async function clearOtherDefaults(id: mongoose.Types.ObjectId): Promise<void> {
  await InvoiceTemplate.updateMany(
    { _id: { $ne: id }, isDefault: true },
    { $set: { isDefault: false } },
  );
}

export async function getDefaultInvoiceTemplate(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await ensureDefaultInvoiceTemplate();
    res.json({ template: toPublic(template) });
  } catch (err) {
    console.error("GET /invoice-templates/default error:", err);
    res.status(500).json({ message: "Failed to load the invoice template" });
  }
}

export async function getInvoiceTemplates(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    await ensureDefaultInvoiceTemplate();
    const templates = await InvoiceTemplate.find().sort({ name: 1 }).lean();
    res.json({ templates: templates.map((template) => toPublic(template)) });
  } catch (err) {
    console.error("GET /invoice-templates error:", err);
    res.status(500).json({ message: "Failed to load invoice templates" });
  }
}

export async function createInvoiceTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createInvoiceTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message || "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const count = await InvoiceTemplate.countDocuments();
    const isDefault = Boolean(parsed.data.isDefault) || count === 0;
    const blocks = sanitizeInvoiceBlocks(
      parsed.data.blocks ?? invoiceBlocksSchema.parse(defaultInvoiceBlocks()),
    );

    if (isDefault) {
      await InvoiceTemplate.updateMany(
        { isDefault: true },
        { $set: { isDefault: false } },
      );
    }

    const template = await InvoiceTemplate.create({
      name: parsed.data.name,
      isDefault,
      blocks,
    });

    res.status(201).json({ template: toPublic(template) });
  } catch (err) {
    if (isDuplicateKey(err)) {
      res.status(409).json({
        message: "Another template is already the default. Try again.",
      });
      return;
    }
    console.error("POST /invoice-templates error:", err);
    res.status(500).json({ message: "Failed to create invoice template" });
  }
}

export async function updateInvoiceTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: "Invalid template id" });
      return;
    }

    const parsed = updateInvoiceTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message || "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const template = await InvoiceTemplate.findById(req.params.id);
    if (!template) {
      res.status(404).json({ message: "Invoice template not found" });
      return;
    }

    if (parsed.data.name !== undefined) template.name = parsed.data.name;
    if (parsed.data.blocks !== undefined) {
      template.blocks = sanitizeInvoiceBlocks(parsed.data.blocks);
      template.markModified("blocks");
    }

    if (parsed.data.isDefault === false && template.isDefault) {
      res.status(400).json({
        message: "Set another template as the default before turning this one off.",
      });
      return;
    }

    if (parsed.data.isDefault === true && !template.isDefault) {
      await clearOtherDefaults(template._id as mongoose.Types.ObjectId);
      template.isDefault = true;
    }

    await template.save();
    res.json({ template: toPublic(template) });
  } catch (err) {
    if (isDuplicateKey(err)) {
      res.status(409).json({
        message: "Another template is already the default. Try again.",
      });
      return;
    }
    console.error("PATCH /invoice-templates/:id error:", err);
    res.status(500).json({ message: "Failed to update invoice template" });
  }
}

export async function deleteInvoiceTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: "Invalid template id" });
      return;
    }

    const count = await InvoiceTemplate.countDocuments();
    if (count <= 1) {
      res.status(400).json({
        message: "The last invoice template cannot be deleted.",
      });
      return;
    }

    const template = await InvoiceTemplate.findById(req.params.id);
    if (!template) {
      res.status(404).json({ message: "Invoice template not found" });
      return;
    }

    let defaultId = "";
    if (template.isDefault) {
      const next = await InvoiceTemplate.findOne({ _id: { $ne: template._id } }).sort({
        updatedAt: -1,
      });
      if (!next) {
        res.status(400).json({
          message: "The last invoice template cannot be deleted.",
        });
        return;
      }
      template.isDefault = false;
      await template.save();
      next.isDefault = true;
      await next.save();
      defaultId = String(next._id);
    } else {
      const current = await InvoiceTemplate.findOne({ isDefault: true }).select("_id");
      defaultId = current ? String(current._id) : "";
    }

    const deletedId = String(template._id);
    await template.deleteOne();
    res.json({ deletedId, defaultId });
  } catch (err) {
    console.error("DELETE /invoice-templates/:id error:", err);
    res.status(500).json({ message: "Failed to delete invoice template" });
  }
}

export function uploadInvoiceTemplateImageMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  imageUpload.single("file")(req, res, (err: unknown) => {
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
        ? "Images must be 5 MB or smaller."
        : err instanceof Error
          ? err.message
          : "Upload failed.",
    });
  });
}

export async function uploadInvoiceTemplateImage(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ message: "A file upload is required." });
      return;
    }
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
      res.status(400).json({
        message: "Only JPEG, PNG, GIF, and WebP images can be uploaded.",
      });
      return;
    }

    const config = await getCloudinarySecretsForUpload();
    if (!config) {
      res.status(400).json({
        message: "Cloudinary credentials are required before uploading images.",
      });
      return;
    }

    const slug = crypto.randomBytes(8).toString("hex");
    const body = new FormData();
    body.append(
      "file",
      new Blob([file.buffer], { type: file.mimetype }),
      file.originalname || "invoice-image",
    );
    if (config.uploadPreset) body.append("upload_preset", config.uploadPreset);
    body.append("public_id", `invoice-templates/${slug}`);
    body.append("folder", "invoice-templates");
    body.append("tags", "invoice-template");

    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`;
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
        message: data.error?.message || "Image upload to Cloudinary failed.",
      });
      return;
    }

    res.status(201).json({ url: data.secure_url });
  } catch (err) {
    console.error("POST /invoice-templates/images error:", err);
    res.status(500).json({ message: "Failed to upload image" });
  }
}

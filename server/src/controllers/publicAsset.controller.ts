import { Request, Response } from "express";
import crypto from "crypto";
import { AuthRequest } from "../middleware/auth.middleware";
import { PublicAsset } from "../models/mongo/PublicAsset";
import { getCloudinarySecretsForUpload } from "./cloudinaryCredentials.controller";

const PUBLIC_ROUTE_PREFIX = "/public-assets";

function generateRandomSlug(): string {
  return crypto.randomBytes(8).toString("hex");
}

function slugIsValid(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function toPublic(doc: any) {
  return {
    _id: doc._id,
    slug: doc.slug,
    title: doc.title,
    mimeType: doc.mimeType,
    publicUrl: doc.publicUrl,
    isActive: Boolean(doc.isActive),
    uploadedBy: doc.uploadedBy ?? undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listPublicAssets(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const assets = await PublicAsset.find().sort({ createdAt: -1 }).lean();
  res.json({ assets: assets.map(toPublic) });
}

export async function uploadPublicAsset(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const file = (req as any).file as Express.Multer.File | undefined;
  const rawSlug = (req.body?.slug ?? "").toString().trim();
  const title =
    (req.body?.title ?? "Public image").toString().trim() || "Public image";

  if (!file) {
    res.status(400).json({ message: "A file upload is required." });
    return;
  }

  const config = await getCloudinarySecretsForUpload();
  if (!config) {
    res.status(400).json({
      message: "Cloudinary credentials are required before uploading images.",
    });
    return;
  }

  const slug = rawSlug && slugIsValid(rawSlug) ? rawSlug : generateRandomSlug();
  const existing = await PublicAsset.findOne({ slug }).lean();
  if (existing) {
    res
      .status(409)
      .json({ message: "A public asset with that slug already exists." });
    return;
  }

  const resourceType = file.mimetype.startsWith("video/") ? "video" : "image";
  const finalTitle = title || "Public image";

  const body = new FormData();
  body.append(
    "file",
    new Blob([file.buffer], { type: file.mimetype }),
    file.originalname || "upload",
  );
  // Preset is optional for authenticated (API key/secret) uploads; omit rather than send an invalid/empty name.
  if (config.uploadPreset) body.append("upload_preset", config.uploadPreset);
  body.append("public_id", `public/${slug}`);
  body.append("folder", "public-assets");
  body.append("tags", `public-asset,${slug}`);

  const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`;
  const response = await fetch(cloudinaryUrl, {
    method: "POST",
    body,
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`,
    },
  });

  const data = (await response.json().catch(() => ({}))) as {
    secure_url?: string;
    public_id?: string;
    error?: { message?: string };
  };

  if (!response.ok || !data.secure_url) {
    res.status(502).json({
      message: data.error?.message || "Image upload to Cloudinary failed.",
    });
    return;
  }

  const doc = await PublicAsset.create({
    slug,
    title: finalTitle,
    mimeType: file.mimetype,
    provider: "cloudinary",
    publicUrl: data.secure_url,
    publicId: data.public_id || `public-assets/${slug}`,
    isActive: true,
    uploadedBy: req.user?.email ?? "system",
  });

  res.status(201).json({ asset: toPublic(doc) });
}

export async function updatePublicAssetStatus(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const { isActive } = req.body ?? {};
  if (typeof isActive !== "boolean") {
    res.status(400).json({
      message: "The isActive field is required and must be a boolean.",
    });
    return;
  }

  const asset = await PublicAsset.findById(req.params.id);
  if (!asset) {
    res.status(404).json({ message: "Public asset not found." });
    return;
  }

  asset.isActive = isActive;
  await asset.save();

  res.json({ asset: toPublic(asset) });
}

export async function getPublicAssetBySlug(
  req: Request,
  res: Response,
): Promise<void> {
  const slug = (req.params.slug ?? "").toString();
  const asset = await PublicAsset.findOne({ slug, isActive: true }).lean();
  if (!asset) {
    res.status(404).json({ message: "Public asset not found or inactive." });
    return;
  }

  res.redirect(asset.publicUrl);
}

export async function publicAssetHealth(
  req: Request,
  res: Response,
): Promise<void> {
  const slug = (req.params.slug ?? "").toString();
  const asset = await PublicAsset.findOne({ slug }).lean();
  if (!asset) {
    res.status(404).json({ message: "Public asset not found." });
    return;
  }

  res.json({
    slug: asset.slug,
    isActive: Boolean(asset.isActive),
    publicUrl: asset.publicUrl,
    mimeType: asset.mimeType,
  });
}

export const PUBLIC_ASSET_ROUTER_PREFIX = PUBLIC_ROUTE_PREFIX;

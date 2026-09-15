import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  TAX_SETTINGS_SLUG,
  TaxSettings,
} from "../models/mongo/TaxSettings";
import { saveTaxSettingsSchema } from "../schemas/taxSettings.schema";
import {
  DEFAULT_TAX_RATE_PERCENT,
  normalizeTaxRatePercent,
} from "../services/taxSettings";

function toPublic(ratePercent: number) {
  return { ratePercent: normalizeTaxRatePercent(ratePercent) };
}

export async function getTaxSettings(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const doc = await TaxSettings.findOne({ slug: TAX_SETTINGS_SLUG }).lean();
    res.json({
      settings: toPublic(doc?.ratePercent ?? DEFAULT_TAX_RATE_PERCENT),
    });
  } catch (err) {
    console.error("GET /tax-settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function saveTaxSettings(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = saveTaxSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const ratePercent = normalizeTaxRatePercent(parsed.data.ratePercent);
    const doc = await TaxSettings.findOneAndUpdate(
      { slug: TAX_SETTINGS_SLUG },
      { $set: { slug: TAX_SETTINGS_SLUG, ratePercent } },
      { new: true, upsert: true },
    );
    res.json({ settings: toPublic(doc.ratePercent) });
  } catch (err) {
    console.error("PUT /tax-settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

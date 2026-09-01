import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  Manufacturer,
  IManufacturer,
  manufacturerNameKey,
} from "../models/mongo/Manufacturer";
import { createManufacturerSchema } from "../schemas/manufacturer.schema";

function toPublic(doc: IManufacturer | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof (doc as IManufacturer).toObject === "function"
      ? (doc as IManufacturer).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    name: d.name ? String(d.name).toUpperCase() : d.name,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getManufacturers(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const manufacturers = await Manufacturer.find()
      .sort({ name: 1 })
      .lean();
    res.json({ manufacturers: manufacturers.map(toPublic) });
  } catch (err) {
    console.error("GET /manufacturers error:", err);
    res.status(500).json({ message: "Failed to fetch manufacturers" });
  }
}

export async function createManufacturer(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createManufacturerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const name = parsed.data.name.trim().toUpperCase();
    const nameKey = manufacturerNameKey(name);
    const existing = await Manufacturer.findOne({ nameKey });
    if (existing) {
      res.status(200).json({ manufacturer: toPublic(existing) });
      return;
    }

    const manufacturer = await Manufacturer.create({ name, nameKey });
    res.status(201).json({ manufacturer: toPublic(manufacturer) });
  } catch (err) {
    console.error("POST /manufacturers error:", err);
    res.status(500).json({ message: "Failed to create manufacturer" });
  }
}

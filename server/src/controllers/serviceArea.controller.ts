import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { ServiceArea } from "../models/mongo/ServiceArea";
import { saveServiceAreasSchema } from "../schemas/serviceArea.schema";

function toPublic(doc: {
  _id: { toString(): string };
  name: string;
  cities: { name: string; sortOrder: number }[];
}) {
  const cities = [...doc.cities].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: doc._id.toString(),
    name: doc.name,
    cities: cities.map((city) => ({ name: city.name })),
  };
}

export async function getServiceAreas(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const docs = await ServiceArea.find().sort({ sortOrder: 1 }).lean();
    res.json({ areas: docs.map(toPublic) });
  } catch (err) {
    console.error("GET /service-areas error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function saveServiceAreas(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = saveServiceAreasSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Validation failed",
      errors: flat.fieldErrors,
    });
    return;
  }

  try {
    const docs = parsed.data.areas.map((area, sortOrder) => ({
      name: area.name,
      sortOrder,
      cities: area.cities.map((city, cityOrder) => ({
        name: city.name,
        sortOrder: cityOrder,
      })),
    }));

    await ServiceArea.deleteMany({});
    const created =
      docs.length > 0 ? await ServiceArea.insertMany(docs) : [];
    const saved = [...created].sort((a, b) => a.sortOrder - b.sortOrder);
    res.json({ areas: saved.map(toPublic) });
  } catch (err) {
    console.error("PUT /service-areas error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

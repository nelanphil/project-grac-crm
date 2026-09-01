import mongoose, { Schema, Document } from "mongoose";
import { Product } from "./Product";

export const DEFAULT_MANUFACTURER_NAME = "GENERAC";

export interface IManufacturer extends Document {
  name: string;
  nameKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export function manufacturerNameKey(name: string): string {
  return name.trim().toLowerCase();
}

const manufacturerSchema = new Schema<IManufacturer>(
  {
    name: { type: String, required: true, trim: true, uppercase: true },
    nameKey: { type: String, required: true, unique: true, trim: true, lowercase: true },
  },
  { timestamps: true },
);

manufacturerSchema.pre("validate", function (next) {
  this.name = (this.name || "").trim().toUpperCase();
  this.nameKey = manufacturerNameKey(this.name);
  next();
});

export const Manufacturer = mongoose.model<IManufacturer>(
  "Manufacturer",
  manufacturerSchema,
);

export async function findManufacturerByName(
  name: string,
): Promise<IManufacturer | null> {
  const nameKey = manufacturerNameKey(name);
  if (!nameKey) return null;
  return Manufacturer.findOne({ nameKey });
}

export async function seedDefaultManufacturers(): Promise<void> {
  const nameKey = manufacturerNameKey(DEFAULT_MANUFACTURER_NAME);
  await Manufacturer.updateOne(
    { nameKey },
    { $setOnInsert: { name: DEFAULT_MANUFACTURER_NAME, nameKey } },
    { upsert: true },
  );

  const generac = await Manufacturer.findOne({ nameKey });
  if (generac) {
    const result = await Product.updateMany(
      { $or: [{ manufacturer: { $exists: false } }, { manufacturer: null }] },
      { $set: { manufacturer: generac._id } },
    );
    if (result.modifiedCount) {
      console.log(`Assigned GENERAC to ${result.modifiedCount} products`);
    }
  }

  const manufacturers = await Manufacturer.find();
  for (const manufacturer of manufacturers) {
    const name = (manufacturer.name || "").trim().toUpperCase();
    if (manufacturer.name !== name) {
      manufacturer.name = name;
      await manufacturer.save();
    }
  }

  console.log("Manufacturers collection seeded");
}

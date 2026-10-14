import mongoose, { Schema, Document } from "mongoose";

export interface IServiceAreaCity {
  name: string;
  sortOrder: number;
}

export interface IServiceArea extends Document {
  name: string;
  sortOrder: number;
  cities: IServiceAreaCity[];
  createdAt: Date;
  updatedAt: Date;
}

const serviceAreaCitySchema = new Schema<IServiceAreaCity>(
  {
    name: { type: String, required: true, trim: true },
    sortOrder: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const serviceAreaSchema = new Schema<IServiceArea>(
  {
    name: { type: String, required: true, trim: true },
    sortOrder: { type: Number, required: true, default: 0 },
    cities: { type: [serviceAreaCitySchema], default: [] },
  },
  { timestamps: true },
);

serviceAreaSchema.index({ sortOrder: 1 });

export const ServiceArea = mongoose.model<IServiceArea>(
  "ServiceArea",
  serviceAreaSchema,
);

/** Keep in sync with client/src/lib/constants.ts SERVICE_AREAS.central. */
export const CENTRAL_FLORIDA_CITIES = [
  "Orlando",
  "Tampa",
  "Lakeland",
  "Kissimmee",
  "Winter Park",
  "Clermont",
  "Sanford",
  "Ocala",
  "Daytona Beach",
  "New Smyrna Beach",
  "The Villages",
  "Lake Mary",
  "Deltona",
] as const;

/** Insert Central Florida only when nothing has been saved yet. */
export async function seedServiceAreas(): Promise<void> {
  const count = await ServiceArea.countDocuments();
  if (count > 0) return;

  await ServiceArea.create({
    name: "Central Florida",
    sortOrder: 0,
    cities: CENTRAL_FLORIDA_CITIES.map((name, sortOrder) => ({
      name,
      sortOrder,
    })),
  });
  console.log("Service areas seeded (Central Florida)");
}

import mongoose, { Schema, Document } from "mongoose";

export interface IContractTemplate extends Document {
  label: string;
  slug: string;
  body: string;
  cost: number;
  badgeIcon: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const contractTemplateSchema = new Schema<IContractTemplate>(
  {
    label: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    body: { type: String, default: "" },
    cost: { type: Number, default: 0, min: 0 },
    badgeIcon: { type: String, default: "scroll-text", trim: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const ContractTemplate = mongoose.model<IContractTemplate>(
  "ContractTemplate",
  contractTemplateSchema,
);

const SERVICE_TEMPLATE = {
  slug: "service",
  label: "Service Contract",
  body: "",
  cost: 0,
  badgeIcon: "scroll-text",
};

/** Ensure the seeded Service template exists (idempotent). */
export async function ensureServiceContractTemplate(): Promise<IContractTemplate> {
  const existing = await ContractTemplate.findOne({ slug: SERVICE_TEMPLATE.slug });
  if (existing) {
    if (existing.deletedAt) {
      existing.deletedAt = null;
      await existing.save();
    }
    return existing;
  }

  return ContractTemplate.create({
    ...SERVICE_TEMPLATE,
    deletedAt: null,
  });
}

/** Backfill customer contracts that still use contractType "service" without a templateId. */
export async function backfillServiceContractTemplateIds(): Promise<number> {
  const { Contract } = await import("./Contract");
  const service = await ensureServiceContractTemplate();

  const result = await Contract.updateMany(
    {
      contractType: "service",
      $or: [{ templateId: null }, { templateId: { $exists: false } }],
    },
    { $set: { templateId: service._id } },
  );

  return result.modifiedCount;
}

export async function seedContractTemplates(): Promise<void> {
  await ensureServiceContractTemplate();
  const backfilled = await backfillServiceContractTemplateIds();
  console.log(
    `Contract templates seeded (service)${backfilled ? `; backfilled ${backfilled} contracts` : ""}`,
  );
}

export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Generate a unique slug from a base string. */
export async function uniqueSlug(base: string): Promise<string> {
  const root = slugifyLabel(base) || "contract";
  let candidate = root;
  let n = 2;
  while (await ContractTemplate.exists({ slug: candidate })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

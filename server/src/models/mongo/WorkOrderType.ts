import mongoose, { Schema, Document, Types } from "mongoose";

export interface IWorkOrderType extends Document {
  label: string;
  slug: string;
  qualifiedUserRefs: Types.ObjectId[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const workOrderTypeSchema = new Schema<IWorkOrderType>(
  {
    label: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    qualifiedUserRefs: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

workOrderTypeSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

export const WorkOrderType = mongoose.model<IWorkOrderType>(
  "WorkOrderType",
  workOrderTypeSchema,
);

export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Generate a slug that is unique among non-deleted types. */
export async function uniqueWorkOrderTypeSlug(base: string): Promise<string> {
  const root = slugifyLabel(base) || "type";
  let candidate = root;
  let n = 2;
  while (await WorkOrderType.exists({ slug: candidate, deletedAt: null })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

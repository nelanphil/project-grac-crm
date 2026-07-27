import mongoose, { Schema, Document } from "mongoose";

export interface IMessageTemplate extends Document {
  name: string;
  slug: string;
  body: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageTemplateSchema = new Schema<IMessageTemplate>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    body: { type: String, default: "" },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const MessageTemplate = mongoose.model<IMessageTemplate>(
  "MessageTemplate",
  messageTemplateSchema,
);

export function slugifyMessageTemplateName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function uniqueMessageTemplateSlug(base: string): Promise<string> {
  const root = slugifyMessageTemplateName(base) || "message";
  let candidate = root;
  let n = 2;
  while (await MessageTemplate.exists({ slug: candidate })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

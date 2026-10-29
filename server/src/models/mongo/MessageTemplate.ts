import mongoose, { Schema, Document, Types } from "mongoose";
import type { EmailChrome } from "../../utils/emailChrome";
import type { RenewalVariants } from "../../utils/renewalVariants";

export const MESSAGE_TEMPLATE_TYPES = ["sms", "email"] as const;
export type MessageTemplateType = (typeof MESSAGE_TEMPLATE_TYPES)[number];

export interface IMessageTemplate extends Document {
  name: string;
  slug: string;
  body: string;
  subject: string;
  templateType: MessageTemplateType;
  emailChrome?: EmailChrome | null;
  offerContractTemplateId?: Types.ObjectId | null;
  /** SMS only. Separate wording for expired, due soon, and active renewals. */
  renewalVariants?: RenewalVariants | null;
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
    subject: { type: String, default: "" },
    templateType: {
      type: String,
      enum: MESSAGE_TEMPLATE_TYPES,
      default: "sms",
      index: true,
    },
    emailChrome: { type: Schema.Types.Mixed, default: undefined },
    offerContractTemplateId: {
      type: Schema.Types.ObjectId,
      ref: "ContractTemplate",
      default: null,
    },
    renewalVariants: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          dueSoonDays: { type: Number, default: 30, min: 1, max: 365 },
          expired: { type: String, default: "" },
          dueSoon: { type: String, default: "" },
          active: { type: String, default: "" },
        },
        { _id: false },
      ),
      default: undefined,
    },
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

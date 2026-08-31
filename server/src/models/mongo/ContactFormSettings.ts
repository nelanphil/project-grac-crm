import mongoose, { Schema, Document } from "mongoose";

export const CONTACT_FORM_SLUG = "contact-form";

export interface IContactFormSettings extends Document {
  slug: string;
  emails: string[];
  createdAt: Date;
  updatedAt: Date;
}

const contactFormSettingsSchema = new Schema<IContactFormSettings>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: CONTACT_FORM_SLUG,
    },
    emails: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

export const ContactFormSettings = mongoose.model<IContactFormSettings>(
  "ContactFormSettings",
  contactFormSettingsSchema,
);

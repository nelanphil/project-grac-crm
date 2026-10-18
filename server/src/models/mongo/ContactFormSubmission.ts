import mongoose, { Schema, Document } from "mongoose";

export const CONTACT_FORM_SUBMISSION_SOURCES = [
  "website",
  "mailbox-import",
] as const;

export type ContactFormSubmissionSource =
  (typeof CONTACT_FORM_SUBMISSION_SOURCES)[number];

export interface IContactFormSubmission extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  source: ContactFormSubmissionSource;
  readAt: Date | null;
  providerMessageId?: string;
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const contactFormSubmissionSchema = new Schema<IContactFormSubmission>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    message: { type: String, required: true },
    source: {
      type: String,
      enum: CONTACT_FORM_SUBMISSION_SOURCES,
      required: true,
    },
    readAt: { type: Date, default: null },
    providerMessageId: { type: String },
    seedKey: { type: String },
  },
  { timestamps: true },
);

contactFormSubmissionSchema.index({ createdAt: -1 });
contactFormSubmissionSchema.index(
  { providerMessageId: 1 },
  { unique: true, sparse: true },
);
contactFormSubmissionSchema.index({ seedKey: 1 }, { unique: true, sparse: true });

export const ContactFormSubmission = mongoose.model<IContactFormSubmission>(
  "ContactFormSubmission",
  contactFormSubmissionSchema,
);

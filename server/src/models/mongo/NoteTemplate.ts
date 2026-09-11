import mongoose, { Schema, Document, Types } from "mongoose";

export const NOTE_TEMPLATE_SCOPES = ["global", "personal"] as const;
export type NoteTemplateScope = (typeof NOTE_TEMPLATE_SCOPES)[number];

export interface INoteTemplate extends Document {
  name: string;
  body: string;
  scope: NoteTemplateScope;
  ownerId: Types.ObjectId | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const noteTemplateSchema = new Schema<INoteTemplate>(
  {
    name: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    scope: {
      type: String,
      enum: NOTE_TEMPLATE_SCOPES,
      required: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

noteTemplateSchema.index({ scope: 1, ownerId: 1, deletedAt: 1, name: 1 });

export const NoteTemplate = mongoose.model<INoteTemplate>(
  "NoteTemplate",
  noteTemplateSchema,
);

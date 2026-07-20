import mongoose, { Schema, Document } from "mongoose";

/**
 * Ledger of applied database migrations. One document per migration `id`
 * from the manifest, written only after the migration completes successfully.
 * The runner uses this to skip already-applied migrations on subsequent runs.
 */
export interface IMigration extends Document {
  migrationId: string;
  appliedAt: Date;
  durationMs: number;
}

const migrationSchema = new Schema<IMigration>({
  migrationId: { type: String, required: true, unique: true, trim: true },
  appliedAt: { type: Date, required: true, default: () => new Date() },
  durationMs: { type: Number, required: true, default: 0 },
});

export const Migration = mongoose.model<IMigration>(
  "Migration",
  migrationSchema,
);

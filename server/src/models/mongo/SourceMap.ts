import mongoose, { Schema, Document } from "mongoose";

export interface ISourceMap extends Document {
  /** Path of the generated JS file relative to the site root, e.g. `_next/static/chunks/abc.js`. */
  file: string;
  /** Gzipped source map JSON. */
  content: Buffer;
  createdAt: Date;
}

const sourceMapSchema = new Schema<ISourceMap>({
  file: { type: String, required: true, unique: true },
  content: { type: Buffer, required: true },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 90,
  },
});

export const SourceMap = mongoose.model<ISourceMap>("SourceMap", sourceMapSchema);

import mongoose, { Schema, Document } from "mongoose";

// UserRole is now an open string to support dynamic roles
export type UserRole = string;

export interface IUser extends Document {
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    first_name: { type: String, required: true, trim: true },
    last_name: { type: String, required: true, trim: true },
    role: { type: String, default: "agent", required: true },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", userSchema);

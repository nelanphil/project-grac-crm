import mongoose, { Schema, Document } from "mongoose";

// UserRole is now an open string to support dynamic roles
export type UserRole = string;

export interface IUserTerritories {
  /** FL county names (no "County" suffix), e.g. "Orange". */
  counties: string[];
  /** Exclusive 5-digit ZIP carve-outs. */
  zips: string[];
}

export interface IUser extends Document {
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  /** Display / login handle (not unique). Never includes numeric suffix. */
  username: string | null;
  /** Unique backend key, e.g. doc1 / doc2. Never exposed to clients. */
  usernameKey: string | null;
  /** Geographic territories for owner-role users. */
  territories: IUserTerritories;
  /** When the user accepted the Terms of Service. */
  termsAcceptedAt: Date | null;
  /** When the user accepted the Privacy Policy. */
  privacyAcceptedAt: Date | null;
  /** Optional opt-in for automated text message alerts. */
  smsOptIn: boolean;
  /** When smsOptIn was last set to true. */
  smsOptInAt: Date | null;
  /** Version string of the legal docs accepted (e.g. "2026-08-03"). */
  legalDocsVersion: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const territoriesSchema = new Schema<IUserTerritories>(
  {
    counties: { type: [String], default: [] },
    zips: { type: [String], default: [] },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    first_name: { type: String, required: true, trim: true },
    last_name: { type: String, required: true, trim: true },
    role: { type: String, default: "agent", required: true },
    username: { type: String, default: null, lowercase: true, trim: true, index: true },
    usernameKey: { type: String, default: null, lowercase: true, trim: true },
    territories: {
      type: territoriesSchema,
      default: () => ({ counties: [], zips: [] }),
    },
    termsAcceptedAt: { type: Date, default: null },
    privacyAcceptedAt: { type: Date, default: null },
    smsOptIn: { type: Boolean, default: false },
    smsOptInAt: { type: Date, default: null },
    legalDocsVersion: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index(
  { usernameKey: 1 },
  { unique: true, partialFilterExpression: { usernameKey: { $type: "string" } } }
);

export const User = mongoose.model<IUser>("User", userSchema);

/** Active (non–soft-deleted) users only. */
export const activeUserFilter = { deletedAt: null } as const;

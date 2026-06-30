import mongoose, { Schema, Document } from "mongoose";

export interface IRole extends Document {
  slug: string;
  label: string;
  isSystem: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    isSystem: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Role = mongoose.model<IRole>("Role", roleSchema);

const SYSTEM_ROLES: { slug: string; label: string }[] = [
  { slug: "super-admin", label: "Super Admin" },
  { slug: "admin",       label: "Administrator" },
  { slug: "owner",       label: "Owner" },
  { slug: "manager",     label: "Manager" },
  { slug: "tech",        label: "Technician" },
  { slug: "agent",       label: "Agent" },
  { slug: "customer",    label: "Customer" },
];

export async function seedDefaultRoles(): Promise<void> {
  for (const { slug, label } of SYSTEM_ROLES) {
    await Role.updateOne(
      { slug },
      { $setOnInsert: { slug, label, isSystem: true, deletedAt: null } },
      { upsert: true }
    );
  }
  console.log("Roles collection seeded");
}

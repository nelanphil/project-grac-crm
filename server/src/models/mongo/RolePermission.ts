import mongoose, { Schema, Document } from "mongoose";
import { UserRole } from "./User";

export interface IRolePermission extends Document {
  role: UserRole;
  permission: string;
}

const rolePermissionSchema = new Schema<IRolePermission>({
  role: { type: String, required: true },
  permission: { type: String, required: true, trim: true },
});

rolePermissionSchema.index({ role: 1, permission: 1 }, { unique: true });

export const RolePermission = mongoose.model<IRolePermission>(
  "RolePermission",
  rolePermissionSchema
);

const ALL_PERMISSIONS = [
  "leads:read", "leads:write", "leads:delete",
  "accounts:read", "accounts:write", "accounts:delete",
  "customers:read", "customers:write", "customers:delete",
  "users:read", "users:write", "users:delete",
  "permissions:manage",
  "jobs:read", "jobs:write", "jobs:delete",
  "reports:read",
];

const DEFAULT_PERMISSIONS: [UserRole, string][] = [
  // super-admin — unrestricted access to everything
  ...ALL_PERMISSIONS.map((p): [UserRole, string] => ["super-admin", p]),

  // admin — full access except permission management
  ["admin", "leads:read"],
  ["admin", "leads:write"],
  ["admin", "leads:delete"],
  ["admin", "accounts:read"],
  ["admin", "accounts:write"],
  ["admin", "accounts:delete"],
  ["admin", "customers:read"],
  ["admin", "customers:write"],
  ["admin", "customers:delete"],
  ["admin", "users:read"],
  ["admin", "users:write"],
  ["admin", "users:delete"],
  ["admin", "jobs:read"],
  ["admin", "jobs:write"],
  ["admin", "jobs:delete"],
  ["admin", "reports:read"],

  // owner — same as admin but also permissions management
  ...ALL_PERMISSIONS.map((p): [UserRole, string] => ["owner", p]),

  // manager — leads, accounts, customers, jobs; read users
  ["manager", "leads:read"],
  ["manager", "leads:write"],
  ["manager", "leads:delete"],
  ["manager", "accounts:read"],
  ["manager", "accounts:write"],
  ["manager", "customers:read"],
  ["manager", "customers:write"],
  ["manager", "users:read"],
  ["manager", "jobs:read"],
  ["manager", "jobs:write"],
  ["manager", "reports:read"],

  // tech — read/write jobs and customers; read leads
  ["tech", "leads:read"],
  ["tech", "customers:read"],
  ["tech", "jobs:read"],
  ["tech", "jobs:write"],

  // agent — read-only leads, accounts, customers
  ["agent", "leads:read"],
  ["agent", "accounts:read"],
  ["agent", "customers:read"],

  // customer — view their own records only (scoped in application logic)
  ["customer", "customers:read"],
];

export async function getPermissionsForRole(role: UserRole): Promise<string[]> {
  const docs = await RolePermission.find({ role }).select("permission -_id").lean();
  return docs.map((d) => d.permission);
}

/**
 * Seeds the role_permissions collection with defaults if it is empty.
 * Called once at server startup.
 */
export async function seedDefaultPermissions(): Promise<void> {
  const count = await RolePermission.countDocuments();
  if (count > 0) return;

  await RolePermission.insertMany(
    DEFAULT_PERMISSIONS.map(([role, permission]) => ({ role, permission }))
  );

  console.log("RolePermission collection seeded with defaults");
}

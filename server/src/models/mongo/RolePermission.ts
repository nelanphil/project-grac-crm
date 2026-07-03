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
  "contracts:read", "contracts:write", "contracts:delete",
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
  ["admin", "contracts:read"],
  ["admin", "contracts:write"],
  ["admin", "contracts:delete"],
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
  ["manager", "contracts:read"],
  ["manager", "contracts:write"],
  ["manager", "users:read"],
  ["manager", "jobs:read"],
  ["manager", "jobs:write"],
  ["manager", "reports:read"],

  // tech — read/write jobs and customers; read leads
  ["tech", "leads:read"],
  ["tech", "customers:read"],
  ["tech", "contracts:read"],
  ["tech", "contracts:write"],
  ["tech", "jobs:read"],
  ["tech", "jobs:write"],

  // agent — read-only leads, accounts, customers
  ["agent", "leads:read"],
  ["agent", "accounts:read"],
  ["agent", "customers:read"],
  ["agent", "contracts:read"],

  // customer — no global customer list access (scoped views only, when implemented)
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

/** Remove global customer list access from the customer role (idempotent). */
export async function revokeCustomerListAccess(): Promise<void> {
  await RolePermission.deleteOne({ role: "customer", permission: "customers:read" });
}

const CONTRACT_PERMISSIONS: [UserRole, string][] = [
  ["super-admin", "contracts:read"],
  ["super-admin", "contracts:write"],
  ["super-admin", "contracts:delete"],
  ["admin", "contracts:read"],
  ["admin", "contracts:write"],
  ["admin", "contracts:delete"],
  ["owner", "contracts:read"],
  ["owner", "contracts:write"],
  ["owner", "contracts:delete"],
  ["manager", "contracts:read"],
  ["manager", "contracts:write"],
  ["tech", "contracts:read"],
  ["tech", "contracts:write"],
  ["agent", "contracts:read"],
];

/** Insert contract permissions for existing deployments (idempotent). */
export async function ensureContractPermissions(): Promise<void> {
  for (const [role, permission] of CONTRACT_PERMISSIONS) {
    await RolePermission.updateOne(
      { role, permission },
      { $setOnInsert: { role, permission } },
      { upsert: true },
    );
  }
}

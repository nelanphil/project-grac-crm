import { Types } from "mongoose";
import { JobRole } from "../models/mongo/JobRole";
import { Role } from "../models/mongo/Role";
import { RolePermission } from "../models/mongo/RolePermission";
import { User } from "../models/mongo/User";
import { scheduleOwnerReassignment } from "./ownerTerritory";
import { clearJobRoleCapabilityCache } from "./jobRoles";
import { CUSTOMER_ROLE, syncRoleFields } from "./roles";

const RETIRED_SECURITY_ROLES = ["tech", "owner", "technician"];

const FIELD_STAFF_PERMISSIONS = [
  "leads:read",
  "customers:read",
  "contracts:read",
  "contracts:write",
  "jobs:read",
  "jobs:write",
  "estimates:read",
  "estimates:write",
  "products:read",
  "discounts:read",
];

function labelsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function findRoleLabelConflict(
  label: string,
  exceptSlug?: string,
): Promise<{ slug: string; label: string } | null> {
  const roles = await Role.find({ deletedAt: null }).select("slug label").lean();
  const match = roles.find(
    (role) =>
      labelsMatch(role.label, label) &&
      (!exceptSlug || role.slug !== exceptSlug),
  );
  return match ? { slug: match.slug, label: match.label } : null;
}

async function ensureFieldStaffRole(): Promise<void> {
  await Role.updateOne(
    { slug: "field-staff" },
    {
      $setOnInsert: {
        slug: "field-staff",
        label: "Field staff",
        isSystem: false,
      },
      $set: { deletedAt: null },
    },
    { upsert: true },
  );

  const existing = await RolePermission.countDocuments({ role: "field-staff" });
  if (existing > 0) return;

  const fromTech = await RolePermission.find({ role: "tech" })
    .select("permission")
    .lean();
  const permissions =
    fromTech.length > 0
      ? [...new Set(fromTech.map((row) => row.permission))]
      : FIELD_STAFF_PERMISSIONS;

  if (permissions.length === 0) return;
  await RolePermission.insertMany(
    permissions.map((permission) => ({ role: "field-staff", permission })),
    { ordered: false },
  ).catch((err: { code?: number }) => {
    if (err?.code !== 11000) throw err;
  });
}

function idList(ids: unknown[] | null | undefined): string[] {
  return (ids ?? []).map((id) => String(id)).filter(Boolean);
}

/**
 * Move Technician and Owner off security roles onto job roles, and set userType.
 * Idempotent: users that already have userType and no retired role slugs are skipped.
 */
export async function migrateToJobRoles(): Promise<void> {
  const technician = await JobRole.findOne({ slug: "technician", deletedAt: null })
    .select("_id")
    .lean();
  const territoryOwner = await JobRole.findOne({
    slug: "territory-owner",
    deletedAt: null,
  })
    .select("_id")
    .lean();
  if (!technician || !territoryOwner) {
    console.warn("Job role migration skipped: system job roles are missing");
    return;
  }

  const technicianId = technician._id as Types.ObjectId;
  const territoryOwnerId = territoryOwner._id as Types.ObjectId;

  const users = await User.find({})
    .select("role roles userType jobRoles schedulable")
    .lean();

  let needsFieldStaff = false;
  const plans: Array<{
    id: unknown;
    userType: "staff" | "customer";
    roles: string[];
    role: string;
    addJobRoles: Types.ObjectId[];
    schedulable: boolean;
    clearTerritory: boolean;
  }> = [];

  for (const doc of users) {
    const existing = Array.isArray(doc.roles) ? doc.roles.filter(Boolean) : [];
    const source = existing.length > 0 ? existing : doc.role ? [doc.role] : ["agent"];
    const retired = source.some((slug) => RETIRED_SECURITY_ROLES.includes(slug));
    const typed =
      doc.userType === "staff" || doc.userType === "customer";
    if (typed && !retired) continue;

    const isCustomer =
      doc.userType === "customer" || source.includes(CUSTOMER_ROLE);
    if (isCustomer) {
      plans.push({
        id: doc._id,
        userType: "customer",
        roles: [CUSTOMER_ROLE],
        role: CUSTOMER_ROLE,
        addJobRoles: [],
        schedulable: false,
        clearTerritory: true,
      });
      continue;
    }

    const hadTech =
      source.includes("tech") ||
      source.includes("technician") ||
      Boolean(doc.schedulable);
    const hadOwner = source.includes("owner");
    let next = source.filter((slug) => !RETIRED_SECURITY_ROLES.includes(slug));
    if (hadOwner && !next.includes("admin") && !next.includes("super-admin")) {
      next = [...next, "admin"];
    }
    if (hadTech && next.length === 0) {
      next = ["field-staff"];
      needsFieldStaff = true;
    }
    const synced = syncRoleFields({ roles: next.length > 0 ? next : ["agent"] });
    const currentJobs = idList(doc.jobRoles as unknown[]);
    const addJobRoles: Types.ObjectId[] = [];
    if (hadTech && !currentJobs.includes(String(technicianId))) {
      addJobRoles.push(technicianId);
    }
    if (hadOwner && !currentJobs.includes(String(territoryOwnerId))) {
      addJobRoles.push(territoryOwnerId);
    }
    const schedulable =
      hadTech || currentJobs.includes(String(technicianId));

    plans.push({
      id: doc._id,
      userType: "staff",
      roles: synced.roles,
      role: synced.role,
      addJobRoles,
      schedulable,
      clearTerritory: false,
    });
  }

  if (needsFieldStaff) await ensureFieldStaffRole();

  for (const plan of plans) {
    const update: Record<string, unknown> = {
      userType: plan.userType,
      roles: plan.roles,
      role: plan.role,
      schedulable: plan.schedulable,
    };
    if (plan.clearTerritory) {
      update.territories = { counties: [], zips: [] };
      update.jobRoles = [];
      update.jobRoleData = {};
    }
    const op: Record<string, unknown> = { $set: update };
    if (!plan.clearTerritory && plan.addJobRoles.length > 0) {
      op.$addToSet = { jobRoles: { $each: plan.addJobRoles } };
    }
    await User.updateOne({ _id: plan.id }, op);
  }

  if (plans.length > 0) {
    console.log(`Migrated ${plans.length} user(s) onto job roles`);
    scheduleOwnerReassignment("migrate-job-roles");
  }

  await RolePermission.deleteMany({ role: { $in: ["tech", "owner", "technician"] } });
  const removed = await Role.deleteMany({
    slug: { $in: ["tech", "owner", "technician"] },
  });
  if (removed.deletedCount) {
    console.log(`Removed retired security roles (${removed.deletedCount})`);
  }
  clearJobRoleCapabilityCache();
}

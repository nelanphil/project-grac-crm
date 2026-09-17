import { Role } from "../models/mongo/Role";
import { RolePermission } from "../models/mongo/RolePermission";
import { User } from "../models/mongo/User";
import { CUSTOMER_ROLE, TECH_ROLE, syncRoleFields } from "./roles";

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

/** Copy `role` into `roles`, add Technician when schedulable, recompute primary. */
export async function migrateUserRoles(): Promise<void> {
  const users = await User.find({})
    .select("role roles schedulable")
    .lean();
  let updated = 0;
  for (const doc of users) {
    const existing = Array.isArray(doc.roles) ? doc.roles.filter(Boolean) : [];
    let next = existing.length > 0 ? existing : doc.role ? [doc.role] : ["agent"];
    if (
      doc.schedulable &&
      !next.includes(CUSTOMER_ROLE) &&
      !next.includes(TECH_ROLE)
    ) {
      next = [...next, TECH_ROLE];
    }
    const synced = syncRoleFields({ roles: next, role: doc.role });
    const sameRoles =
      JSON.stringify(synced.roles) === JSON.stringify(existing) &&
      synced.role === doc.role;
    if (sameRoles) continue;
    await User.updateOne(
      { _id: doc._id },
      { $set: { roles: synced.roles, role: synced.role, schedulable: synced.roles.includes(TECH_ROLE) } },
    );
    updated += 1;
  }
  if (updated > 0) {
    console.log(`Migrated roles for ${updated} user(s)`);
  }
}

/**
 * Fold a custom Technician role (slug technician, or duplicate label) into
 * the system `tech` role so only one Technician card remains.
 */
export async function mergeDuplicateTechnicianRoles(): Promise<void> {
  const systemTech = await Role.findOne({ slug: TECH_ROLE, deletedAt: null });
  if (!systemTech) return;

  const dupes = await Role.find({
    deletedAt: null,
    slug: { $ne: TECH_ROLE },
  })
    .select("slug label")
    .lean();

  const extras = dupes.filter(
    (role) =>
      role.slug === "technician" || labelsMatch(role.label, systemTech.label),
  );
  if (extras.length === 0) return;

  for (const extra of extras) {
    await User.updateMany(
      { $or: [{ roles: extra.slug }, { role: extra.slug }] },
      { $addToSet: { roles: TECH_ROLE } },
    );
    await User.updateMany({ roles: extra.slug }, { $pull: { roles: extra.slug } });
    await User.updateMany({ role: extra.slug }, { $set: { role: TECH_ROLE } });
    await RolePermission.deleteMany({ role: extra.slug });
    await Role.updateOne({ _id: extra._id }, { $set: { deletedAt: new Date() } });
    console.log(
      `Merged duplicate role ${extra.slug} (${extra.label}) into ${TECH_ROLE}`,
    );
  }

  await migrateUserRoles();
}

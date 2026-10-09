export const CUSTOMER_ROLE = "customer";

export const ROLE_RANK = [
  "super-admin",
  "admin",
  "manager",
  "agent",
  "customer",
] as const;

export const DISPATCHER_ROLES = ["super-admin", "admin"] as const;
export const ORG_ADMIN_ROLES = ["super-admin", "admin"] as const;

export type UserType = "staff" | "customer";

export type JobRoleCapability = "schedulable" | "territoryOwner";

export type RoleLike =
  | string
  | null
  | undefined
  | string[]
  | {
      role?: string | null;
      roles?: string[] | null;
      userType?: string | null;
    };

function uniqueNonEmpty(slugs: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of slugs) {
    const slug = typeof raw === "string" ? raw.trim() : "";
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export function normalizeRoles(input: RoleLike): string[] {
  if (!input) return [];
  if (typeof input === "string") return uniqueNonEmpty([input]);
  if (Array.isArray(input)) return uniqueNonEmpty(input);
  const fromRoles = Array.isArray(input.roles) ? input.roles : [];
  if (fromRoles.length > 0) return uniqueNonEmpty(fromRoles);
  return uniqueNonEmpty([input.role]);
}

export function primaryRole(input: RoleLike): string | undefined {
  const roles = normalizeRoles(input);
  if (roles.length === 0) return undefined;
  for (const rank of ROLE_RANK) {
    if (roles.includes(rank)) return rank;
  }
  return roles[0];
}

export function hasRole(input: RoleLike, ...slugs: string[]): boolean {
  if (slugs.length === 0) return false;
  const roles = normalizeRoles(input);
  return slugs.some((slug) => roles.includes(slug));
}

/** Staff vs customer comes from `userType` when it is set. */
export function isCustomerRole(role: RoleLike): boolean {
  if (role && typeof role === "object" && !Array.isArray(role)) {
    if (role.userType === "customer") return true;
    if (role.userType === "staff") return false;
  }
  return hasRole(role, CUSTOMER_ROLE);
}

export function isStaffUser(role: RoleLike): boolean {
  if (role && typeof role === "object" && !Array.isArray(role)) {
    if (role.userType === "staff") return true;
    if (role.userType === "customer") return false;
  }
  const roles = normalizeRoles(role);
  return roles.length > 0 && !hasRole(roles, CUSTOMER_ROLE);
}

export function isStaffRole(role: RoleLike): boolean {
  return isStaffUser(role);
}

export function isDispatcherRole(role: RoleLike): boolean {
  return hasRole(role, ...DISPATCHER_ROLES);
}

export function isAdminRole(role: RoleLike): boolean {
  return isDispatcherRole(role);
}

export function isOrgAdminRole(role: RoleLike): boolean {
  return hasRole(role, ...ORG_ADMIN_ROLES);
}

export function isSuperAdminRole(role: RoleLike): boolean {
  return hasRole(role, "super-admin");
}

export function hasJobRoleCapability(
  jobRoleIds: string[] | null | undefined,
  catalog: Array<{
    _id: string;
    capabilities?: { schedulable?: boolean; territoryOwner?: boolean } | null;
  }>,
  capability: JobRoleCapability,
): boolean {
  const selected = new Set(jobRoleIds ?? []);
  return catalog.some(
    (role) => selected.has(role._id) && Boolean(role.capabilities?.[capability]),
  );
}

export function userHasCapability(
  user: {
    jobRoles?: string[] | null;
    capabilities?: { schedulable?: boolean; territoryOwner?: boolean } | null;
    schedulable?: boolean;
  } | null
    | undefined,
  capability: JobRoleCapability,
): boolean {
  if (!user) return false;
  if (user.capabilities && typeof user.capabilities[capability] === "boolean") {
    return Boolean(user.capabilities[capability]);
  }
  if (capability === "schedulable") return Boolean(user.schedulable);
  return false;
}

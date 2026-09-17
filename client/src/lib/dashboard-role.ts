export const CUSTOMER_ROLE = "customer";
export const TECH_ROLE = "tech";

export const ROLE_RANK = [
  "super-admin",
  "admin",
  "owner",
  "manager",
  "tech",
  "agent",
  "customer",
] as const;

export const DISPATCHER_ROLES = ["super-admin", "admin", "owner"] as const;
export const ORG_ADMIN_ROLES = ["super-admin", "admin"] as const;

export type RoleLike =
  | string
  | null
  | undefined
  | string[]
  | {
      role?: string | null;
      roles?: string[] | null;
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

/** Staff = every authenticated role except customer. */
export function isCustomerRole(role: RoleLike): boolean {
  return hasRole(role, CUSTOMER_ROLE);
}

export function isStaffRole(role: RoleLike): boolean {
  const roles = normalizeRoles(role);
  return roles.length > 0 && !isCustomerRole(roles);
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

export function isOwnerRole(role: RoleLike): boolean {
  return hasRole(role, "owner");
}

export function isTechnicianRole(role: RoleLike): boolean {
  return hasRole(role, TECH_ROLE);
}

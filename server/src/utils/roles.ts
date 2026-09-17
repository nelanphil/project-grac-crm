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

export class RoleAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleAssignmentError";
  }
}

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

export function isCustomerRole(input: RoleLike): boolean {
  return hasRole(input, CUSTOMER_ROLE);
}

export function isStaffRole(input: RoleLike): boolean {
  const roles = normalizeRoles(input);
  return roles.length > 0 && !isCustomerRole(roles);
}

export function isDispatcherRole(input: RoleLike): boolean {
  return hasRole(input, ...DISPATCHER_ROLES);
}

export function isOrgAdminRole(input: RoleLike): boolean {
  return hasRole(input, ...ORG_ADMIN_ROLES);
}

export function isAdminRole(input: RoleLike): boolean {
  return hasRole(input, ...DISPATCHER_ROLES);
}

export function isOwnerRole(input: RoleLike): boolean {
  return hasRole(input, "owner");
}

export function isSuperAdminRole(input: RoleLike): boolean {
  return hasRole(input, "super-admin");
}

export function isTechnicianRole(input: RoleLike): boolean {
  return hasRole(input, TECH_ROLE);
}

export function assignableRoles(slugs: string[]): string[] {
  const roles = uniqueNonEmpty(slugs);
  if (roles.length === 0) {
    throw new RoleAssignmentError("At least one role is required");
  }
  if (roles.includes(CUSTOMER_ROLE) && roles.length > 1) {
    throw new RoleAssignmentError(
      "Customer cannot be combined with other roles",
    );
  }
  return roles;
}

export function rolesFromPayload(input: {
  role?: string;
  roles?: string[];
}): string[] {
  if (input.roles && input.roles.length > 0) {
    return assignableRoles(input.roles);
  }
  if (input.role) return assignableRoles([input.role]);
  throw new RoleAssignmentError("At least one role is required");
}

export function syncRoleFields(input: RoleLike): {
  roles: string[];
  role: string;
} {
  const roles = normalizeRoles(input);
  if (roles.includes(CUSTOMER_ROLE)) {
    return { roles: [CUSTOMER_ROLE], role: CUSTOMER_ROLE };
  }
  const assigned = roles.length > 0 ? roles : ["agent"];
  return { roles: assigned, role: primaryRole(assigned) ?? "agent" };
}

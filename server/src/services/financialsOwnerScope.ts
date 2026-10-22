import { isOrgAdminRole } from "../utils/roles";

const ADMIN_JOB_ROLE_NAMES = new Set([
  "super admin",
  "admin",
  "administrator",
]);

function roleName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function isFinancialsAdmin(input: {
  roles?: string[] | null;
  jobRoleSlugs?: string[] | null;
  jobRoleLabels?: string[] | null;
}): boolean {
  if (isOrgAdminRole({ roles: input.roles ?? [] })) return true;
  const names = [...(input.jobRoleSlugs ?? []), ...(input.jobRoleLabels ?? [])];
  return names.some((name) => ADMIN_JOB_ROLE_NAMES.has(roleName(name)));
}

export type FinancialsOwnerDecision = {
  canChoose: boolean;
  /** null is the company-wide report. */
  ownerId: string | null;
};

/**
 * Admins may request all or one owner. A territory owner who is not an admin
 * is forced to their own id. Everyone else stays on the company-wide report.
 */
export function resolveFinancialsOwnerRequest(input: {
  roles?: string[] | null;
  jobRoleSlugs?: string[] | null;
  jobRoleLabels?: string[] | null;
  territoryOwner: boolean;
  selfId: string;
  requestedOwnerId: string | null;
}): FinancialsOwnerDecision {
  const canChoose = isFinancialsAdmin(input);
  if (canChoose) {
    const requested = (input.requestedOwnerId ?? "").trim();
    return { canChoose: true, ownerId: requested || null };
  }
  if (input.territoryOwner) {
    return { canChoose: false, ownerId: input.selfId };
  }
  return { canChoose: false, ownerId: null };
}

/**
 * Work orders for one CRM owner: the mapped website login, plus CRM-native
 * tickets (no legacy user id) on customers they own.
 */
export function ownerWorkOrderMongoFilter(
  legacyUserId: number | null,
  customerIds: readonly unknown[],
): Record<string, unknown> {
  const native =
    customerIds.length > 0
      ? {
          customerRef: { $in: [...customerIds] },
          $or: [{ userId: null }, { userId: { $exists: false } }],
        }
      : null;
  if (legacyUserId != null && native) {
    return { $or: [{ userId: legacyUserId }, native] };
  }
  if (legacyUserId != null) return { userId: legacyUserId };
  if (native) return native;
  return { _id: { $exists: false } };
}

export function workOrderBelongsToOwner(
  workOrder: { userId?: number | null; customerRef?: string | null },
  legacyUserId: number | null,
  ownedCustomerIds: ReadonlySet<string>,
): boolean {
  if (legacyUserId != null && workOrder.userId === legacyUserId) return true;
  const hasLegacyUser =
    typeof workOrder.userId === "number" && Number.isFinite(workOrder.userId);
  if (hasLegacyUser) return false;
  const customerRef = workOrder.customerRef ?? "";
  return Boolean(customerRef) && ownedCustomerIds.has(customerRef);
}

export function mergeMongoFilters(
  ...filters: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const parts = filters.filter(
    (filter): filter is Record<string, unknown> =>
      Boolean(filter) && Object.keys(filter as Record<string, unknown>).length > 0,
  );
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return { $and: parts };
}

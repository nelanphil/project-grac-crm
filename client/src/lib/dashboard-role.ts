/** Staff = every authenticated role except customer. */
export function isCustomerRole(role: string | null | undefined): boolean {
  return role === "customer";
}

export function isStaffRole(role: string | null | undefined): boolean {
  return Boolean(role) && !isCustomerRole(role);
}

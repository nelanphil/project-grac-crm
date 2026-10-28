/**
 * Website logins that map onto CRM territory owners.
 * complete.php totals are work orders with that user_id.
 */

export type LegacyLoginOwner = {
  legacyUserId: number;
  firstName: string;
  lastName: string;
};

export const LEGACY_LOGIN_OWNERS: readonly LegacyLoginOwner[] = [
  { legacyUserId: 1, firstName: "Christopher", lastName: "Hatton" },
  { legacyUserId: 2, firstName: "Dustin", lastName: "Hatton" },
];

/** Legacy user ids whose customers are kept. Everyone else from a dump is excluded. */
export const ALLOWED_LEGACY_OWNER_USER_IDS: readonly number[] =
  LEGACY_LOGIN_OWNERS.map((owner) => owner.legacyUserId);

export function isAllowedLegacyOwner(
  userId: number | null | undefined,
): boolean {
  return (
    typeof userId === "number" &&
    ALLOWED_LEGACY_OWNER_USER_IDS.includes(userId)
  );
}

/**
 * Mongo filter for legacy-imported customers outside the owner allow-list.
 * userId 0 is a CRM-created record and is not matched.
 */
export const nonOwnerLegacyCustomerFilter = {
  userId: { $gt: 0, $nin: [...ALLOWED_LEGACY_OWNER_USER_IDS] },
} as const;

export function legacyOwnerForUserId(userId: number): LegacyLoginOwner | null {
  return LEGACY_LOGIN_OWNERS.find((owner) => owner.legacyUserId === userId) ?? null;
}

export function legacyUserIdForOwnerName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): number | null {
  const first = (firstName ?? "").trim().toLowerCase();
  const last = (lastName ?? "").trim().toLowerCase();
  if (!first || !last) return null;
  const match = LEGACY_LOGIN_OWNERS.find(
    (owner) =>
      owner.firstName.toLowerCase() === first &&
      owner.lastName.toLowerCase() === last,
  );
  return match?.legacyUserId ?? null;
}

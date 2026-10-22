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

import { toProperCase } from "./formatName";

/** Customer name used when a property has no owner contact. */
export const VACANT_ACCOUNT_NAME = "Vacant";

export function isVacantAccountName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === VACANT_ACCOUNT_NAME.toLowerCase();
}

/** Title-cased "First Last" for a person. Blank when both names are empty. */
export function accountNameFromPerson(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  return [toProperCase(first), toProperCase(last)].filter(Boolean).join(" ");
}

/**
 * A vacant report row is an active, unmerged customer with no active contact.
 * The account name is often "Vacant", but a renamed property with no contact
 * still belongs on the report.
 */
export function isVacantReportCustomer(input: {
  deletedAt?: Date | null;
  mergedIntoRef?: unknown;
  activeContactCount: number;
}): boolean {
  if (input.deletedAt) return false;
  if (input.mergedIntoRef) return false;
  return input.activeContactCount === 0;
}

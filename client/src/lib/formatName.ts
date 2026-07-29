/** Title-cases each word (e.g. "JOHN DOE" → "John Doe"). */
export function toProperCase(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (char) => char.toUpperCase());
}

export function formatCustomerName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  return [toProperCase(first), toProperCase(last)].filter(Boolean).join(" ");
}

/** Prefer durable account name; fall back to primary-contact first/last. */
export function formatCustomerRecordName(customer: {
  accountName?: string | null;
  first?: string | null;
  last?: string | null;
}): string {
  const account = customer.accountName?.trim();
  if (account) return account;
  return formatCustomerName(customer.first, customer.last);
}

/** Normalizes state for display; defaults empty values to FL. */
export function formatCustomerState(state: string | null | undefined): string {
  const normalized = state?.trim().toUpperCase() ?? "";
  return normalized || "FL";
}

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

/**
 * Prefer the durable account name. An all-lowercase account name is title-cased
 * for display so a person stored as "alex golovkov" reads "Alex Golovkov".
 * Names that already contain capitals (GRAC, ABC LLC) stay as stored.
 */
export function formatCustomerRecordName(customer: {
  accountName?: string | null;
  first?: string | null;
  last?: string | null;
}): string {
  const account = customer.accountName?.trim();
  if (!account) return formatCustomerName(customer.first, customer.last);
  if (!/\p{Lu}/u.test(account)) return toProperCase(account);
  return account;
}

/** Account name, plus contact when it differs. Falls back to an em dash. */
export function invoiceCustomerLabel(invoice: {
  customerName?: string;
  contactName?: string;
}): string {
  const customer = invoice.customerName?.trim();
  const contact = invoice.contactName?.trim();
  if (customer && contact && contact.toLowerCase() !== customer.toLowerCase()) {
    return `${customer} · ${contact}`;
  }
  return customer || contact || "—";
}

/** Normalizes state for display; defaults empty values to FL. */
export function formatCustomerState(state: string | null | undefined): string {
  const normalized = state?.trim().toUpperCase() ?? "";
  return normalized || "FL";
}

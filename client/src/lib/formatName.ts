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

/** Normalizes state for display; defaults empty values to FL. */
export function formatCustomerState(state: string | null | undefined): string {
  const normalized = state?.trim().toUpperCase() ?? "";
  return normalized || "FL";
}

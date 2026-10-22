/** Title-cases each word (e.g. "JOHN DOE" → "John Doe"). */
export function toProperCase(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (char) => char.toUpperCase());
}

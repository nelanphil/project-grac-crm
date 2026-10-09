function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchTokens(search: string): string[] {
  return search.trim().split(/\s+/).filter(Boolean);
}

/**
 * Every whitespace-separated token must match at least one field, so
 * "Ryan James" finds a record stored as first "Ryan" / last "James".
 */
export function buildTokenSearchFilter(
  search: string,
  fields: string[],
): Record<string, unknown> | null {
  const tokens = searchTokens(search);
  if (tokens.length === 0 || fields.length === 0) return null;
  const clauses = tokens.map((token) => {
    const rx = new RegExp(escapeRegex(token), "i");
    return { $or: fields.map((field) => ({ [field]: rx })) };
  });
  return clauses.length === 1 ? clauses[0]! : { $and: clauses };
}

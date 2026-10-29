export type InboxListParams = {
  blocked?: unknown;
  status?: unknown;
  filter?: unknown;
  channel?: unknown;
  q?: unknown;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inboxListFilter(
  query: InboxListParams,
  matchedCustomerIds: unknown[] = [],
): Record<string, unknown>[] {
  const showBlocked = query.blocked === "1" || query.blocked === "true";
  const status = String(query.status || "open");
  const filterName = String(query.filter || "");
  const channel = String(query.channel || "");
  const q = String(query.q || "").trim();
  const and: Record<string, unknown>[] = [];
  if (showBlocked) {
    and.push({ deletedAt: null });
    and.push({ blocked: true });
  } else if (q) {
    // Searching reaches deleted, closed, and never-answered chats so staff can bring them back.
    and.push({ blocked: { $ne: true } });
  } else {
    and.push({ deletedAt: null });
    and.push({ blocked: { $ne: true } });
    and.push({ lastInboundAt: { $ne: null } });
    if (status === "open" || status === "closed") and.push({ status });
    if (filterName === "unread") and.push({ unreadCount: { $gt: 0 } });
    if (filterName === "unresponded") and.push({ lastDirection: "inbound" });
  }
  if (channel === "text") and.push({ lastChannel: { $in: ["sms", "mms"] } });
  else if (channel === "sms" || channel === "mms" || channel === "voice" || channel === "email") {
    and.push({ lastChannel: channel });
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const or: Record<string, unknown>[] = [{ displayName: rx }, { handle: rx }];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ handle: new RegExp(digits) });
    if (matchedCustomerIds.length > 0) or.push({ customerRef: { $in: matchedCustomerIds } });
    and.push({ $or: or });
  }
  return and;
}

/** Inbound SMS/MMS that staff have not opened, or that arrived after the last open. */
export function unreadTextQuery(): Record<string, unknown> {
  return {
    lastMessageDirection: "inbound",
    lastMessageChannel: { $in: ["sms", "mms"] },
    $or: [
      { readAt: null },
      { $expr: { $gt: ["$lastMessageAt", "$readAt"] } },
    ],
  };
}

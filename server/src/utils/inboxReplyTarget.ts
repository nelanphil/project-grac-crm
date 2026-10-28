import { Types } from "mongoose";

export class ReplyTargetError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Picks the email a reply quotes and threads onto.
 * `replyToEmailId` is an email id from this conversation, "new" for no thread,
 * or empty for the latest inbound email. Lookups must be scoped to the conversation.
 */
export async function resolveReplyTarget<T>(
  replyToEmailId: unknown,
  lookup: {
    byId: (id: Types.ObjectId) => Promise<T | null>;
    latestInbound: () => Promise<T | null>;
  },
): Promise<T | null> {
  const value = typeof replyToEmailId === "string" ? replyToEmailId.trim() : "";
  if (!value) return lookup.latestInbound();
  if (value === "new") return null;
  if (!Types.ObjectId.isValid(value)) {
    throw new ReplyTargetError("Choose a valid email to reply to.");
  }
  const target = await lookup.byId(new Types.ObjectId(value));
  if (!target) {
    throw new ReplyTargetError("That email isn't part of this conversation.", 404);
  }
  return target;
}

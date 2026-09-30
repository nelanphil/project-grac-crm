import mongoose, { Types } from "mongoose";
import { User } from "../models/mongo/User";
import { logNotificationAsync } from "./notification.service";

export function displayTicketNumber(doc: {
  number?: string | null;
  legacyId?: number | null;
  _id?: unknown;
}): string {
  const number = (doc.number ?? "").trim();
  if (number) return number;
  if (doc.legacyId) return String(doc.legacyId);
  return doc._id ? String(doc._id).slice(-6) : "";
}

export interface NoteMention {
  id: string;
  firstName: string;
  lastName: string;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function sanitizeMentionUserIds(
  ids: string[] | undefined,
): Promise<Types.ObjectId[]> {
  const unique = uniqueIds(ids ?? []).filter((id) =>
    mongoose.isValidObjectId(id),
  );
  if (unique.length === 0) return [];
  const users = await User.find({
    _id: { $in: unique },
    userType: "staff",
    deletedAt: null,
  })
    .select("_id")
    .lean();
  const allowed = new Set(users.map((user) => String(user._id)));
  return unique
    .filter((id) => allowed.has(id))
    .map((id) => new Types.ObjectId(id));
}

export function readMentionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object" && "_id" in item) {
        return String((item as { _id: unknown })._id);
      }
      return String(item ?? "");
    })
    .filter((id) => mongoose.isValidObjectId(id));
}

export function readMentions(value: unknown): NoteMention[] {
  if (!Array.isArray(value)) return [];
  const mentions: NoteMention[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || !("_id" in item)) continue;
    const rec = item as {
      _id: { toString(): string };
      first_name?: string;
      last_name?: string;
    };
    mentions.push({
      id: rec._id.toString(),
      firstName: rec.first_name ?? "",
      lastName: rec.last_name ?? "",
    });
  }
  return mentions;
}

/** Author plus everyone tagged. A reminder with no tags goes only to the author. */
export function createAudience(
  authorId: string,
  mentionIds: string[],
  isReminder: boolean,
): string[] {
  const mentions = uniqueIds(mentionIds);
  if (mentions.length > 0) return uniqueIds([authorId, ...mentions]);
  if (isReminder && authorId) return [authorId];
  return [];
}

/**
 * Edit notifications go to newly tagged staff. Turning a reminder on notifies
 * the author only when they were not already in the audience.
 */
export function editAudience(opts: {
  authorId: string;
  prevMentionIds: string[];
  nextMentionIds: string[];
  prevReminder: boolean;
  nextReminder: boolean;
}): string[] {
  const prev = new Set(opts.prevMentionIds.map(String));
  const fresh = uniqueIds(
    opts.nextMentionIds.map(String).filter((id) => id && !prev.has(id)),
  );
  const recipients = new Set(fresh);
  const reminderTurnedOn = !opts.prevReminder && opts.nextReminder;
  const authorAlreadyCovered = opts.prevMentionIds.length > 0 || opts.prevReminder;
  if (reminderTurnedOn && !authorAlreadyCovered && opts.authorId) {
    recipients.add(opts.authorId);
  }
  return [...recipients];
}

export function notifyNoteAudience(input: {
  entityType: "work_order_note" | "estimate_note";
  noteId: string;
  recipientIds: string[];
  isReminder: boolean;
  ticketNumber: string;
  ticketId: string;
  customerRef?: Types.ObjectId | null;
  customerName?: string;
  actorUserId?: string | null;
}): void {
  const recipientIds = uniqueIds(input.recipientIds);
  if (recipientIds.length === 0) return;

  const kind = input.entityType === "work_order_note" ? "work order" : "estimate";
  const number = input.ticketNumber.trim() || input.ticketId;
  const customer = (input.customerName ?? "").trim();
  const summary = input.isReminder
    ? `Reminder on ${kind} ${number}${customer ? ` for ${customer}` : ""}`
    : `Mentioned on ${kind} ${number}${customer ? ` for ${customer}` : ""}`;

  const metadata: Record<string, unknown> = {
    reminder: input.isReminder,
    ticketNumber: number,
    customerName: customer,
  };
  if (input.entityType === "work_order_note") {
    metadata.workOrderId = input.ticketId;
  } else {
    metadata.estimateId = input.ticketId;
  }

  logNotificationAsync({
    entityType: input.entityType,
    action: "mentioned",
    entityId: input.noteId,
    summary,
    customerRef: input.customerRef ?? null,
    actorUserId: input.actorUserId ?? null,
    recipientUserIds: recipientIds,
    metadata,
    direct: true,
  });
}

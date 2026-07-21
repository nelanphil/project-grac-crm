import mongoose, { FilterQuery, Types } from "mongoose";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  INotificationEvent,
  NotificationAction,
  NotificationActorType,
  NotificationEntityType,
  NotificationEvent,
  OPERATIONAL_ENTITY_TYPES,
} from "../models/mongo/NotificationEvent";
import { NotificationRead } from "../models/mongo/NotificationRead";
import { User } from "../models/mongo/User";

const FULL_ACCESS_ROLES = new Set(["super-admin", "admin", "owner"]);

export interface LogNotificationInput {
  entityType: NotificationEntityType;
  action: NotificationAction;
  entityId: string;
  summary: string;
  customerRef?: Types.ObjectId | string | null;
  actorType?: NotificationActorType;
  actorUserId?: string | null;
  actorName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NotificationListItem {
  id: string;
  entityType: NotificationEntityType;
  action: NotificationAction;
  actorType: NotificationActorType;
  actorUserId: string | null;
  actorName: string;
  customerRef: string | null;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export interface AuthUserLike {
  id: string;
  role: string;
}

export function actorFromRequest(user?: { id: string } | null): {
  actorType: NotificationActorType;
  actorUserId: string | null;
} {
  if (user?.id) {
    return { actorType: "user", actorUserId: user.id };
  }
  return { actorType: "system", actorUserId: null };
}

export function customerDisplayName(c: {
  first?: string | null;
  last?: string | null;
}): string {
  const name = `${c.first ?? ""} ${c.last ?? ""}`.trim();
  return name || "Customer";
}

function toObjectId(value: string | Types.ObjectId | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  if (mongoose.isValidObjectId(value)) return new Types.ObjectId(value);
  return null;
}

async function resolveActorName(
  actorUserId: string | null | undefined,
  fallback?: string | null
): Promise<string> {
  if (fallback?.trim()) return fallback.trim();
  const id = toObjectId(actorUserId);
  if (!id) return "System";
  const user = await User.findById(id).select("first_name last_name email").lean();
  if (!user) return "System";
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return name || user.email || "System";
}

export async function logNotification(input: LogNotificationInput): Promise<void> {
  try {
    const actorType = input.actorType ?? (input.actorUserId ? "user" : "system");
    const actorUserId = toObjectId(input.actorUserId);
    const actorName =
      actorType === "system" && !input.actorUserId
        ? input.actorName?.trim() || "System"
        : await resolveActorName(input.actorUserId, input.actorName);

    await NotificationEvent.create({
      entityType: input.entityType,
      action: input.action,
      actorType,
      actorUserId,
      actorName,
      customerRef: toObjectId(input.customerRef ?? null),
      entityId: String(input.entityId),
      summary: input.summary.trim(),
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    console.error("[notifications] failed to log event", err);
  }
}

/** Fire-and-forget wrapper so callers never await logging. */
export function logNotificationAsync(input: LogNotificationInput): void {
  void logNotification(input);
}

export async function resolveCustomerRefsForUser(
  userId: string
): Promise<Types.ObjectId[]> {
  const id = toObjectId(userId);
  if (!id) return [];
  const contacts = await CustomerContact.find({ userRef: id })
    .select("customerRef")
    .lean();
  const unique = new Map<string, Types.ObjectId>();
  for (const c of contacts) {
    if (c.customerRef) unique.set(String(c.customerRef), c.customerRef as Types.ObjectId);
  }
  return [...unique.values()];
}

export async function buildVisibilityFilter(
  user: AuthUserLike
): Promise<FilterQuery<INotificationEvent>> {
  if (FULL_ACCESS_ROLES.has(user.role)) {
    return {};
  }

  if (user.role === "customer") {
    const refs = await resolveCustomerRefsForUser(user.id);
    if (refs.length === 0) {
      return { _id: { $in: [] } };
    }
    return { customerRef: { $in: refs } };
  }

  // manager, tech, agent, and unknown non-customer roles: operational CRM only
  return { entityType: { $in: OPERATIONAL_ENTITY_TYPES } };
}

function serializeEvent(
  event: INotificationEvent | (INotificationEvent & { _id: Types.ObjectId }),
  readIds: Set<string>
): NotificationListItem {
  const id = String(event._id);
  return {
    id,
    entityType: event.entityType,
    action: event.action,
    actorType: event.actorType,
    actorUserId: event.actorUserId ? String(event.actorUserId) : null,
    actorName: event.actorName,
    customerRef: event.customerRef ? String(event.customerRef) : null,
    entityId: event.entityId,
    summary: event.summary,
    metadata: (event.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(event.createdAt).toISOString(),
    read: readIds.has(id),
  };
}

export async function listForUser(
  user: AuthUserLike,
  opts: { limit?: number; before?: string } = {}
): Promise<{ items: NotificationListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const visibility = await buildVisibilityFilter(user);
  const filter: FilterQuery<INotificationEvent> = { ...visibility };

  if (opts.before) {
    const beforeId = toObjectId(opts.before);
    if (beforeId) {
      const beforeDoc = await NotificationEvent.findById(beforeId).select("createdAt").lean();
      if (beforeDoc) {
        filter.$or = [
          { createdAt: { $lt: beforeDoc.createdAt } },
          { createdAt: beforeDoc.createdAt, _id: { $lt: beforeId } },
        ];
      }
    }
  }

  const events = await NotificationEvent.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const page = events.slice(0, limit);
  const eventIds = page.map((e) => e._id);
  const reads = await NotificationRead.find({
    userId: toObjectId(user.id),
    eventId: { $in: eventIds },
  })
    .select("eventId")
    .lean();

  const readIds = new Set(reads.map((r) => String(r.eventId)));
  const items = page.map((e) =>
    serializeEvent(
      e as unknown as INotificationEvent,
      readIds
    )
  );
  const nextCursor =
    events.length > limit ? String(page[page.length - 1]._id) : null;

  return { items, nextCursor };
}

export async function unreadCount(user: AuthUserLike): Promise<number> {
  const userId = toObjectId(user.id);
  if (!userId) return 0;

  const visibility = await buildVisibilityFilter(user);
  const readEventIds = await NotificationRead.find({ userId }).distinct("eventId");

  return NotificationEvent.countDocuments({
    ...visibility,
    _id: { $nin: readEventIds },
  });
}

export async function markRead(
  user: AuthUserLike,
  eventId: string
): Promise<boolean> {
  const id = toObjectId(eventId);
  const userId = toObjectId(user.id);
  if (!id || !userId) return false;

  const visibility = await buildVisibilityFilter(user);
  const event = await NotificationEvent.findOne({ _id: id, ...visibility })
    .select("_id")
    .lean();
  if (!event) return false;

  await NotificationRead.updateOne(
    { userId, eventId: id },
    { $setOnInsert: { userId, eventId: id, readAt: new Date() } },
    { upsert: true }
  );
  return true;
}

export async function markAllRead(user: AuthUserLike): Promise<number> {
  const userId = toObjectId(user.id);
  if (!userId) return 0;

  const visibility = await buildVisibilityFilter(user);
  const events = await NotificationEvent.find(visibility).select("_id").lean();
  if (events.length === 0) return 0;

  const existing = await NotificationRead.find({
    userId,
    eventId: { $in: events.map((e) => e._id) },
  })
    .select("eventId")
    .lean();
  const already = new Set(existing.map((r) => String(r.eventId)));
  const toInsert = events
    .filter((e) => !already.has(String(e._id)))
    .map((e) => ({
      userId,
      eventId: e._id,
      readAt: new Date(),
    }));

  if (toInsert.length === 0) return 0;
  await NotificationRead.insertMany(toInsert, { ordered: false });
  return toInsert.length;
}

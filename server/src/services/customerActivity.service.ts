import mongoose, { FilterQuery, Types } from "mongoose";
import {
  ACTIVITY_ACTOR_KINDS,
  ACTIVITY_CATEGORIES,
  ACTIVITY_SOURCES,
  ActivityActorKind,
  ActivityCategory,
  ActivitySource,
  CustomerActivity,
  ICustomerActivity,
} from "../models/mongo/CustomerActivity";
import { Customer } from "../models/mongo/Customer";
import { User } from "../models/mongo/User";
import { isCustomerRole } from "../utils/roles";
import { publishCustomerActivity } from "./customerActivityLive";

export interface ActivityChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface CustomerActivityItem {
  id: string;
  customerRef: string;
  category: ActivityCategory;
  action: string;
  actorKind: ActivityActorKind;
  actorUserId: string | null;
  actorName: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  changes: ActivityChange[];
  metadata: Record<string, unknown>;
  source: ActivitySource;
  ip: string | null;
  backfilled: boolean;
  createdAt: string;
  customerName?: string | null;
}

export interface RecordActivityInput {
  customerRef: Types.ObjectId | string;
  category: ActivityCategory;
  action: string;
  summary: string;
  actorKind?: ActivityActorKind;
  actorUserId?: string | null;
  actorName?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  changes?: ActivityChange[];
  metadata?: Record<string, unknown>;
  source?: ActivitySource;
  ip?: string | null;
  sourceEventId?: string | null;
  backfilled?: boolean;
  createdAt?: Date;
  /** Skip when the same action was recorded for this entity inside the window. */
  throttleMs?: number;
  /** Live writes publish to open History tabs. Backfill leaves this false. */
  publish?: boolean;
}

const ENTITY_CATEGORY: Record<string, ActivityCategory> = {
  customer: "account",
  contact: "contact",
  address: "address",
  equipment: "equipment",
  work_order: "work_order",
  contract: "contract",
  estimate: "estimate",
  invoice: "invoice",
  payment: "payment",
  customer_note: "note",
  work_order_note: "note",
  estimate_note: "note",
  mailbox_message: "communication",
  contact_form: "communication",
  lead: "account",
  user: "auth",
  discount_code: "payment",
};

export function categoryForEntityType(entityType: string): ActivityCategory {
  return ENTITY_CATEGORY[entityType] ?? "account";
}

export function isActivityCategory(value: string): value is ActivityCategory {
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(value);
}

export function isActivityActorKind(value: string): value is ActivityActorKind {
  return (ACTIVITY_ACTOR_KINDS as readonly string[]).includes(value);
}

export function isActivitySource(value: string): value is ActivitySource {
  return (ACTIVITY_SOURCES as readonly string[]).includes(value);
}

export function actorKindFromUser(
  user: {
    userType?: string | null;
    role?: string | null;
    roles?: string[] | null;
  } | null,
): ActivityActorKind {
  if (!user) return "system";
  return isCustomerRole(user) ? "customer" : "staff";
}

function toObjectId(
  value: string | Types.ObjectId | null | undefined,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  if (mongoose.isValidObjectId(value)) return new Types.ObjectId(value);
  return null;
}

function comparable(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): ActivityChange[] {
  const changes: ActivityChange[] = [];
  for (const field of keys) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (comparable(from) === comparable(to)) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

export function changesFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ActivityChange[] {
  const raw = metadata?.changes;
  if (!Array.isArray(raw)) return [];
  const changes: ActivityChange[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const field = typeof row.field === "string" ? row.field.trim() : "";
    if (!field) continue;
    changes.push({
      field,
      from: row.from ?? null,
      to: row.to ?? null,
    });
  }
  return changes;
}

export function metadataWithoutChanges(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "changes" || key === "activitySource") continue;
    next[key] = value;
  }
  return next;
}

export function activityCursorClause(
  cursor: { createdAt: Date; id: string },
  direction: "before" | "after",
): FilterQuery<ICustomerActivity> {
  const id = toObjectId(cursor.id);
  if (direction === "after") {
    return {
      $or: [
        { createdAt: { $gt: cursor.createdAt } },
        ...(id
          ? [{ createdAt: cursor.createdAt, _id: { $gt: id } }]
          : []),
      ],
    };
  }
  return {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      ...(id ? [{ createdAt: cursor.createdAt, _id: { $lt: id } }] : []),
    ],
  };
}

export function activityListFilter(input: {
  customerId?: Types.ObjectId | null;
  categories?: ActivityCategory[];
  actorKind?: ActivityActorKind | null;
  cursor?: { createdAt: Date; id: string } | null;
  direction?: "before" | "after";
  until?: Date | null;
}): FilterQuery<ICustomerActivity> {
  const clauses: FilterQuery<ICustomerActivity>[] = [];
  if (input.customerId) clauses.push({ customerRef: input.customerId });
  if (input.until) clauses.push({ createdAt: { $lte: input.until } });
  if (input.categories && input.categories.length > 0) {
    clauses.push({ category: { $in: input.categories } });
  }
  if (input.actorKind) {
    clauses.push({ actorKind: input.actorKind });
  }
  if (input.cursor) {
    clauses.push(
      activityCursorClause(input.cursor, input.direction ?? "before"),
    );
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

export async function withCustomerNames(
  items: CustomerActivityItem[],
): Promise<CustomerActivityItem[]> {
  const ids = [
    ...new Set(items.map((item) => item.customerRef).filter((id) => Types.ObjectId.isValid(id))),
  ];
  if (ids.length === 0) return items;
  const customers = await Customer.find({ _id: { $in: ids } })
    .select("accountName")
    .lean();
  const names = new Map(
    customers.map((customer) => [String(customer._id), customer.accountName ?? ""]),
  );
  return items.map((item) => ({
    ...item,
    customerName: names.get(item.customerRef) || null,
  }));
}

function serializeActivity(
  event: ICustomerActivity | (ICustomerActivity & { _id: Types.ObjectId }),
): CustomerActivityItem {
  const changes = Array.isArray(event.changes)
    ? event.changes.map((change) => ({
        field: change.field,
        from: change.from ?? null,
        to: change.to ?? null,
      }))
    : [];
  return {
    id: String(event._id),
    customerRef: String(event.customerRef),
    category: event.category,
    action: event.action,
    actorKind: event.actorKind,
    actorUserId: event.actorUserId ? String(event.actorUserId) : null,
    actorName: event.actorName,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    summary: event.summary,
    changes,
    metadata: (event.metadata as Record<string, unknown>) ?? {},
    source: event.source,
    ip: event.ip ?? null,
    backfilled: Boolean(event.backfilled),
    createdAt: new Date(event.createdAt).toISOString(),
  };
}

async function resolveActor(input: RecordActivityInput): Promise<{
  actorKind: ActivityActorKind;
  actorUserId: Types.ObjectId | null;
  actorName: string;
}> {
  const actorUserId = toObjectId(input.actorUserId);
  if (!actorUserId) {
    const actorKind = input.actorKind ?? "system";
    const fallback =
      input.actorName?.trim() ||
      (actorKind === "customer" ? "Customer" : actorKind === "staff" ? "Staff" : "System");
    return { actorKind, actorUserId: null, actorName: fallback };
  }

  if (input.actorKind && input.actorName?.trim()) {
    return {
      actorKind: input.actorKind,
      actorUserId,
      actorName: input.actorName.trim(),
    };
  }

  const user = await User.findById(actorUserId)
    .select("first_name last_name email userType role roles")
    .lean();
  const         actorKind = input.actorKind ?? actorKindFromUser(user);
  const lookedUp = user
    ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email
    : "";
  return {
    actorKind,
    actorUserId,
    actorName:
      input.actorName?.trim() ||
      lookedUp ||
      (actorKind === "customer" ? "Customer" : "Staff"),
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

export async function recordCustomerActivity(
  input: RecordActivityInput,
): Promise<CustomerActivityItem | null> {
  const customerRef = toObjectId(input.customerRef);
  if (!customerRef) return null;
  const summary = input.summary.trim();
  if (!summary) return null;

  try {
    if (input.throttleMs && input.throttleMs > 0) {
      const recent = await CustomerActivity.exists({
        customerRef,
        action: input.action,
        entityId: input.entityId ? String(input.entityId) : null,
        createdAt: { $gte: new Date(Date.now() - input.throttleMs) },
      });
      if (recent) return null;
    }

    const actor = await resolveActor(input);
    const sourceEventId = input.sourceEventId?.trim() || undefined;
    const created = await CustomerActivity.create({
      customerRef,
      category: input.category,
      action: input.action.trim(),
      actorKind: actor.actorKind,
      actorUserId: actor.actorUserId,
      actorName: actor.actorName,
      entityType: input.entityType?.trim() || null,
      entityId: input.entityId ? String(input.entityId) : null,
      summary,
      changes: input.changes ?? [],
      metadata: input.metadata ?? {},
      source: input.source ?? "crm",
      ip: input.ip?.trim() || null,
      ...(sourceEventId ? { sourceEventId } : {}),
      backfilled: Boolean(input.backfilled),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    });

    const item = serializeActivity(created);
    if (input.publish !== false) {
      publishCustomerActivity(String(customerRef), item);
    }
    return item;
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    console.error("[customer-activity] failed to record", err);
    return null;
  }
}

export function recordCustomerActivityAsync(input: RecordActivityInput): void {
  void recordCustomerActivity(input);
}

export interface ListActivityOptions {
  before?: string;
  after?: string;
  limit?: number;
  categories?: string[];
  actorKind?: string;
  /** Drop rows dated after this instant. Used by the dashboard feed. */
  until?: Date;
}

export async function listCustomerActivity(
  customerId: string | null,
  opts: ListActivityOptions = {},
): Promise<{ items: CustomerActivityItem[]; nextCursor: string | null }> {
  const id = customerId ? toObjectId(customerId) : null;
  if (customerId && !id) return { items: [], nextCursor: null };

  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const categories = (opts.categories ?? []).filter(isActivityCategory);
  const actorKind = opts.actorKind && isActivityActorKind(opts.actorKind)
    ? opts.actorKind
    : null;
  const direction = opts.after ? "after" : "before";
  const cursorId = opts.after || opts.before;
  let cursor: { createdAt: Date; id: string } | null = null;
  if (cursorId) {
    const cursorDocId = toObjectId(cursorId);
    if (cursorDocId) {
      const cursorDoc = await CustomerActivity.findOne({
        _id: cursorDocId,
        ...(id ? { customerRef: id } : {}),
      })
        .select("createdAt")
        .lean();
      if (cursorDoc) {
        cursor = { createdAt: cursorDoc.createdAt, id: String(cursorDoc._id) };
      }
    }
  }

  const filter = activityListFilter({
    customerId: id,
    categories,
    actorKind,
    cursor,
    direction,
    until: opts.until,
  });

  const events = await CustomerActivity.find(filter)
    .sort(
      direction === "after"
        ? { createdAt: 1, _id: 1 }
        : { createdAt: -1, _id: -1 },
    )
    .limit(limit + 1)
    .lean();

  const page = events.slice(0, limit);
  if (direction === "after") page.reverse();
  const items = page.map((event) =>
    serializeActivity(event as unknown as ICustomerActivity),
  );
  const nextCursor =
    direction === "before" && events.length > limit
      ? String(page[page.length - 1]._id)
      : null;
  return { items: await withCustomerNames(items), nextCursor };
}

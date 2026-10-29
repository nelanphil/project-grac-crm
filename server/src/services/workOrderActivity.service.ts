import mongoose, { Model, Types } from "mongoose";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { User } from "../models/mongo/User";
import {
  WORK_ORDER_ORIGINS,
  type WorkOrderOrigin,
} from "../models/mongo/WorkOrder";
import {
  IWorkOrderActivity,
  IWorkOrderActivityChange,
  WorkOrderActivity,
  WorkOrderActivityAction,
  WorkOrderActivityActorKind,
  WorkOrderActivitySource,
} from "../models/mongo/WorkOrderActivity";
import {
  formatLocalDate,
  formatLocalTime,
  storedTicketDateKey,
} from "../utils/scheduleTime";

export const WORK_ORDER_FIELD_UPDATE_WINDOW_MS = 10 * 60 * 1000;

export type WorkOrderActivityActor = {
  actorKind?: WorkOrderActivityActorKind;
  actorUserId?: string | null;
  actorName?: string | null;
};

export type WorkOrderFieldChange = IWorkOrderActivityChange;

export type FieldUpdatePlan =
  | { kind: "skip" }
  | { kind: "insert"; changes: WorkOrderFieldChange[] }
  | { kind: "update"; changes: WorkOrderFieldChange[] };

export type WorkOrderActivityEntry = {
  id: string;
  action: string;
  actorKind: WorkOrderActivityActorKind;
  actorName: string;
  summary: string;
  changes: WorkOrderFieldChange[];
  createdAt: string;
};

export type WorkOrderActivityLog = {
  origin: WorkOrderOrigin;
  createdByName: string | null;
  createdAt: string;
  entries: WorkOrderActivityEntry[];
};

type TrackedField = {
  key: string;
  label: string;
};

const TRACKED_FIELDS: TrackedField[] = [
  { key: "customerName", label: "Customer" },
  { key: "customerAddress", label: "Address" },
  { key: "customerCity", label: "City" },
  { key: "customerState", label: "State" },
  { key: "customerZip", label: "ZIP" },
  { key: "customerPhone", label: "Phone" },
  { key: "customerEmail", label: "Email" },
  { key: "workPhone", label: "Work phone" },
  { key: "descPerform", label: "Work to perform" },
  { key: "descPerformed", label: "Work performed" },
  { key: "parts", label: "Parts" },
  { key: "totalParts", label: "Parts total" },
  { key: "totalLabor", label: "Labor total" },
  { key: "totalAgreements", label: "Agreements total" },
  { key: "laborHours", label: "Labor hours" },
  { key: "laborOverridden", label: "Labor overridden" },
  { key: "miscExp", label: "Miscellaneous" },
  { key: "subtotal", label: "Subtotal" },
  { key: "shipping", label: "Shipping" },
  { key: "tax", label: "Tax" },
  { key: "taxRate", label: "Tax rate" },
  { key: "total", label: "Total" },
  { key: "paid", label: "Paid" },
  { key: "completed", label: "Completed" },
  { key: "date", label: "Date" },
  { key: "startTime", label: "Start time" },
  { key: "endTime", label: "End time" },
  { key: "tech", label: "Technician" },
  { key: "assignedUserRefs", label: "Crew" },
  { key: "scheduledStart", label: "Scheduled start" },
  { key: "scheduledEnd", label: "Scheduled end" },
  { key: "routeLocked", label: "Route lock" },
  { key: "runHours", label: "Run hours" },
  { key: "serialNumber", label: "Serial number" },
  { key: "generatorModel", label: "Generator model" },
  { key: "exerciseDay", label: "Exercise day" },
  { key: "exerciseTime", label: "Exercise time" },
  { key: "workOrderTypeRef", label: "Work order type" },
  { key: "addressRef", label: "Site" },
  { key: "equipmentRef", label: "Equipment" },
  { key: "certify", label: "Certified" },
  { key: "signedByName", label: "Signed by" },
];

const SCHEDULE_LABELS = new Set([
  "Date",
  "Start time",
  "End time",
  "Technician",
  "Crew",
  "Scheduled start",
  "Scheduled end",
  "Route lock",
]);

const MONEY_KEYS = new Set([
  "totalParts",
  "totalLabor",
  "totalAgreements",
  "miscExp",
  "subtotal",
  "shipping",
  "tax",
  "total",
]);

const BOOLEAN_KEYS = new Set([
  "paid",
  "completed",
  "laborOverridden",
  "taxOverridden",
  "routeLocked",
  "certify",
]);

const ID_KEYS = new Set(["workOrderTypeRef", "addressRef", "equipmentRef"]);

export function actorFromAuthUser(user?: { id: string } | null): WorkOrderActivityActor {
  if (user?.id) return { actorKind: "staff", actorUserId: user.id };
  return { actorKind: "system", actorUserId: null, actorName: "System" };
}

export function classifyWorkOrderOrigin(workOrder: {
  origin?: string | null;
  legacyId?: number | null;
  legacyLinkedAt?: Date | string | null;
  number?: string | null;
}): WorkOrderOrigin {
  const legacyId =
    typeof workOrder.legacyId === "number" && Number.isFinite(workOrder.legacyId);
  const number = Boolean(workOrder.number && workOrder.number.trim());
  if (workOrder.legacyLinkedAt || (legacyId && number)) return "legacy_linked";
  if (
    workOrder.origin &&
    (WORK_ORDER_ORIGINS as readonly string[]).includes(workOrder.origin)
  ) {
    return workOrder.origin as WorkOrderOrigin;
  }
  if (legacyId && !number) return "legacy_import";
  return "user";
}

export function snapshotWorkOrderFields(doc: object): Record<string, unknown> {
  const source = doc as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of TRACKED_FIELDS) {
    out[field.key] = cloneTrackedValue(field.key, source[field.key]);
  }
  return out;
}

export function diffWorkOrderFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): WorkOrderFieldChange[] {
  const changes: WorkOrderFieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const prev = describeField(field.key, before[field.key]);
    const next = describeField(field.key, after[field.key]);
    if (prev.token === next.token) continue;
    let to = next.display;
    if (prev.display === next.display) {
      to = next.display === "—" ? "Cleared" : `${next.display} (edited)`;
    }
    changes.push({ field: field.label, from: prev.display, to });
  }
  return changes;
}

export function summarizeFieldChanges(changes: WorkOrderFieldChange[]): string {
  if (changes.length === 0) return "Work order updated";
  const labels = changes.map((change) => change.field.toLowerCase());
  if (labels.length === 1) return `Updated ${labels[0]}`;
  if (labels.length <= 3) return `Updated ${labels.join(", ")}`;
  return `Updated ${labels.length} fields`;
}

export function planFieldUpdate(input: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actorUserId: string | null;
  now: Date;
  recent: {
    actorUserId: string | null;
    fields: string[];
    createdAt: Date;
    changes: WorkOrderFieldChange[];
  } | null;
  windowMs?: number;
}): FieldUpdatePlan {
  const changes = diffWorkOrderFields(input.before, input.after);
  if (changes.length === 0) return { kind: "skip" };
  const windowMs = input.windowMs ?? WORK_ORDER_FIELD_UPDATE_WINDOW_MS;
  const recent = input.recent;
  if (
    recent &&
    input.actorUserId &&
    recent.actorUserId === input.actorUserId &&
    input.now.getTime() - recent.createdAt.getTime() <= windowMs &&
    sameFieldSet(recent.fields, changes.map((change) => change.field))
  ) {
    return { kind: "update", changes: mergeCollapsedChanges(recent.changes, changes) };
  }
  return { kind: "insert", changes };
}

export async function recordWorkOrderActivity(
  input: {
    workOrderRef: Types.ObjectId | string;
    action: WorkOrderActivityAction;
    actor?: WorkOrderActivityActor | null;
    summary: string;
    changes?: WorkOrderFieldChange[];
    source?: WorkOrderActivitySource;
    sourceEventId?: string | null;
  },
  ActivityModel: Model<IWorkOrderActivity> = WorkOrderActivity,
): Promise<IWorkOrderActivity | null> {
  const workOrderRef = toObjectId(input.workOrderRef);
  if (!workOrderRef) return null;
  try {
    const actorKind =
      input.actor?.actorKind ?? (input.actor?.actorUserId ? "staff" : "system");
    const actorName = await resolveActorName(input.actor, actorKind);
    const sourceEventId = input.sourceEventId?.trim() || undefined;
    return await ActivityModel.create({
      workOrderRef,
      action: input.action,
      actorKind,
      actorUserId: toObjectId(input.actor?.actorUserId ?? null),
      actorName,
      summary: input.summary.trim() || "Work order updated",
      changes: input.changes ?? [],
      source: input.source ?? "crm",
      ...(sourceEventId ? { sourceEventId } : {}),
    });
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    console.error("[work-order-activity] failed to record", err);
    return null;
  }
}

export async function recordWorkOrderFieldUpdate(input: {
  workOrderRef: Types.ObjectId | string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actor?: WorkOrderActivityActor | null;
  now?: Date;
}): Promise<FieldUpdatePlan["kind"]> {
  const workOrderRef = toObjectId(input.workOrderRef);
  if (!workOrderRef) return "skip";
  const now = input.now ?? new Date();
  const actorUserId = input.actor?.actorUserId ?? null;
  const recentDoc = actorUserId
    ? await WorkOrderActivity.findOne({
        workOrderRef,
        action: "updated",
        actorUserId: toObjectId(actorUserId),
        createdAt: { $gte: new Date(now.getTime() - WORK_ORDER_FIELD_UPDATE_WINDOW_MS) },
      }).sort({ createdAt: -1 })
    : null;
  const plan = planFieldUpdate({
    before: input.before,
    after: input.after,
    actorUserId,
    now,
    recent: recentDoc
      ? {
          actorUserId: recentDoc.actorUserId ? String(recentDoc.actorUserId) : null,
          fields: recentDoc.changes.map((change) => change.field),
          createdAt: recentDoc.createdAt,
          changes: recentDoc.changes.map((change) => ({
            field: change.field,
            from: change.from,
            to: change.to,
          })),
        }
      : null,
  });
  if (plan.kind === "skip") return "skip";
  const net = plan.changes.filter((change) => change.from !== change.to);
  if (plan.kind === "update" && recentDoc) {
    if (net.length === 0) {
      await recentDoc.deleteOne();
      return "update";
    }
    recentDoc.changes = net;
    recentDoc.summary = summarizeFieldChanges(net);
    await recentDoc.save();
    return "update";
  }
  await recordWorkOrderActivity({
    workOrderRef,
    action: "updated",
    actor: input.actor,
    summary: summarizeFieldChanges(net),
    changes: net,
    source: "crm",
  });
  return "insert";
}

export async function recordWorkOrderScheduleChanges(input: {
  actor?: WorkOrderActivityActor | null;
  jobs: Array<{
    id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
}): Promise<void> {
  if (!input.actor) return;
  for (const job of input.jobs) {
    const changes = diffWorkOrderFields(job.before, job.after).filter((change) =>
      SCHEDULE_LABELS.has(change.field),
    );
    if (changes.length === 0) continue;
    const action = scheduleAction(changes);
    await recordWorkOrderActivity({
      workOrderRef: job.id,
      action,
      actor: input.actor,
      summary: scheduleSummary(action, changes),
      changes,
      source: "crm",
    });
  }
}

export async function recordLegacyWorkOrderImport(
  input: {
    workOrderRef: Types.ObjectId | string;
    legacyId: number;
  },
  ActivityModel: Model<IWorkOrderActivity> = WorkOrderActivity,
): Promise<void> {
  await recordWorkOrderActivity(
    {
      workOrderRef: input.workOrderRef,
      action: "created",
      actor: { actorKind: "system", actorName: "System" },
      summary: "Imported from the legacy system",
      source: "legacy_dump",
      sourceEventId: `legacy-import:${input.legacyId}`,
    },
    ActivityModel,
  );
}

export async function recordLegacyWorkOrderUpdate(
  input: {
    workOrderRef: Types.ObjectId | string;
    changes: WorkOrderFieldChange[];
  },
  ActivityModel: Model<IWorkOrderActivity> = WorkOrderActivity,
): Promise<void> {
  const changes = input.changes.filter((change) => change.from !== change.to);
  if (changes.length === 0) return;
  await recordWorkOrderActivity(
    {
      workOrderRef: input.workOrderRef,
      action: "legacy_updated",
      actor: { actorKind: "system", actorName: "System" },
      summary: "Updated from the legacy import",
      changes,
      source: "legacy_dump",
    },
    ActivityModel,
  );
}

export async function buildWorkOrderActivityLog(workOrder: {
  _id: Types.ObjectId | string;
  origin?: string | null;
  legacyId?: number | null;
  legacyLinkedAt?: Date | string | null;
  number?: string | null;
  createdAt?: Date | string | null;
}): Promise<WorkOrderActivityLog> {
  const id = String(workOrder._id);
  const origin = classifyWorkOrderOrigin(workOrder);
  const createdAt = workOrder.createdAt ? new Date(workOrder.createdAt) : new Date();
  const [stored, notifications, noteNotifications] = await Promise.all([
    WorkOrderActivity.find({ workOrderRef: id }).sort({ createdAt: -1 }).limit(300).lean(),
    NotificationEvent.find({ entityType: "work_order", entityId: id })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    NotificationEvent.find({
      entityType: "work_order_note",
      "metadata.workOrderId": id,
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
  ]);

  const earliestActivity = stored.reduce<Date | null>((earliest, row) => {
    if (!earliest || row.createdAt < earliest) return row.createdAt;
    return earliest;
  }, null);
  const coveredNotifications = new Set(
    stored
      .map((row) => row.sourceEventId)
      .filter((value): value is string => Boolean(value && value.startsWith("notification:"))),
  );

  const entries: WorkOrderActivityEntry[] = stored.map((row) => ({
    id: String(row._id),
    action: row.action,
    actorKind: row.actorKind,
    actorName: row.actorName || "System",
    summary: row.summary,
    changes: (row.changes ?? []).map((change) => ({
      field: change.field,
      from: change.from ?? "",
      to: change.to ?? "",
    })),
    createdAt: row.createdAt.toISOString(),
  }));

  for (const notification of [...notifications, ...noteNotifications]) {
    const notificationId = `notification:${String(notification._id)}`;
    if (coveredNotifications.has(notificationId)) continue;
    if (earliestActivity && notification.createdAt.getTime() >= earliestActivity.getTime()) {
      continue;
    }
    entries.push({
      id: notificationId,
      action: notificationAction(notification.entityType, notification.action, notification.summary),
      actorKind: notification.actorType === "user" ? "staff" : "system",
      actorName: notification.actorName?.trim() || "System",
      summary: notification.summary,
      changes: [],
      createdAt: notification.createdAt.toISOString(),
    });
  }

  if (!entries.some((entry) => entry.action === "created")) {
    entries.push(syntheticSetupEntry(workOrder, origin, createdAt));
  }

  entries.sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt);
    if (byTime !== 0) return byTime;
    return b.id.localeCompare(a.id);
  });

  const setup = [...entries]
    .filter((entry) => entry.action === "created")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

  return {
    origin,
    createdByName: createdByName(origin, setup),
    createdAt: (setup ? new Date(setup.createdAt) : createdAt).toISOString(),
    entries,
  };
}

function syntheticSetupEntry(
  workOrder: { _id: Types.ObjectId | string },
  origin: WorkOrderOrigin,
  createdAt: Date,
): WorkOrderActivityEntry {
  if (origin === "legacy_import") {
    return {
      id: `setup:${String(workOrder._id)}`,
      action: "created",
      actorKind: "system",
      actorName: "System",
      summary: "Imported from the legacy system",
      changes: [],
      createdAt: createdAt.toISOString(),
    };
  }
  if (origin === "legacy_linked") {
    return {
      id: `setup:${String(workOrder._id)}`,
      action: "created",
      actorKind: "staff",
      actorName: "Unknown",
      summary: "Set up in the CRM, later linked to a legacy record",
      changes: [],
      createdAt: createdAt.toISOString(),
    };
  }
  return {
    id: `setup:${String(workOrder._id)}`,
    action: "created",
    actorKind: "staff",
    actorName: "Unknown",
    summary: "Created in the CRM",
    changes: [],
    createdAt: createdAt.toISOString(),
  };
}

function createdByName(
  origin: WorkOrderOrigin,
  setup: WorkOrderActivityEntry | undefined,
): string | null {
  if (origin === "legacy_import") return null;
  const name = setup?.actorName?.trim();
  if (name && name !== "System" && name !== "Unknown") return name;
  return "Unknown";
}

function notificationAction(
  entityType: string,
  action: string,
  summary: string,
): string {
  if (entityType === "work_order_note") {
    if (action === "created") return "note_added";
    if (action === "deleted") return "note_removed";
    return "note_updated";
  }
  const text = summary.toLowerCase();
  if (text.includes("appointment canceled")) return "appointment_canceled";
  if (text.includes("restored")) return "restored";
  if (text.includes("marked complete") || text.includes("marked paid")) return "completed";
  return action;
}

function scheduleAction(changes: WorkOrderFieldChange[]): WorkOrderActivityAction {
  if (changes.length > 0 && changes.every((change) => change.field === "Route lock")) {
    return "route_locked";
  }
  if (changes.some((change) => change.field === "Crew" || change.field === "Technician")) {
    return "assigned";
  }
  return "scheduled";
}

function scheduleSummary(
  action: WorkOrderActivityAction,
  changes: WorkOrderFieldChange[],
): string {
  if (action === "route_locked") {
    const lock = changes.find((change) => change.field === "Route lock");
    return lock?.to === "Yes" ? "Locked the stop on the route" : "Unlocked the route stop";
  }
  if (action === "assigned") {
    const tech = changes.find((change) => change.field === "Technician");
    const name = tech?.to && tech.to !== "—" ? tech.to : "";
    return name ? `Assigned to ${name}` : "Changed the crew";
  }
  const start = changes.find((change) => change.field === "Scheduled start");
  if (start?.to && start.to !== "—") return `Scheduled for ${start.to}`;
  return "Updated the appointment";
}

function sameFieldSet(left: string[], right: string[]): boolean {
  const a = [...left].sort().join("\0");
  const b = [...right].sort().join("\0");
  return a === b;
}

function mergeCollapsedChanges(
  previous: WorkOrderFieldChange[],
  next: WorkOrderFieldChange[],
): WorkOrderFieldChange[] {
  const prior = new Map(previous.map((change) => [change.field, change]));
  return next.map((change) => {
    const earlier = prior.get(change.field);
    return earlier ? { field: change.field, from: earlier.from, to: change.to } : change;
  });
}

function cloneTrackedValue(key: string, value: unknown): unknown {
  if (key === "parts") return plainParts(value);
  if (key === "assignedUserRefs") {
    return Array.isArray(value) ? value.map((id) => idString(id)) : [];
  }
  const date = asDate(value);
  if (date && (value instanceof Date || key === "date" || key === "scheduledStart" || key === "scheduledEnd")) {
    return new Date(date.getTime());
  }
  return value;
}

function describeField(key: string, value: unknown): { token: string; display: string } {
  if (key === "parts") return describeParts(value);
  if (key === "assignedUserRefs") return describeCrew(value);
  if (key === "date") {
    const date = asDate(value);
    const label = date ? storedTicketDateKey(date) || "—" : "—";
    return { token: label, display: label };
  }
  if (key === "scheduledStart" || key === "scheduledEnd") {
    const date = asDate(value);
    if (!date) return { token: "", display: "—" };
    const label = `${formatLocalDate(date)} ${formatLocalTime(date)}`;
    return { token: date.toISOString(), display: label };
  }
  if (MONEY_KEYS.has(key)) {
    const amount = asNumber(value);
    const token = amount == null ? "" : amount.toFixed(2);
    return { token, display: amount == null ? "—" : `$${token}` };
  }
  if (key === "taxRate" || key === "laborHours" || key === "runHours") {
    const amount = asNumber(value);
    const token = amount == null ? "" : String(amount);
    return { token, display: amount == null ? "—" : token };
  }
  if (BOOLEAN_KEYS.has(key)) {
    const on = Boolean(value);
    return { token: on ? "yes" : "no", display: on ? "Yes" : "No" };
  }
  if (ID_KEYS.has(key)) {
    const id = idString(value);
    return { token: id, display: id ? "Set" : "—" };
  }
  const text = value == null ? "" : String(value).trim();
  return { token: text, display: clip(text) };
}

function describeParts(value: unknown): { token: string; display: string } {
  const lines = plainParts(value);
  const token = JSON.stringify(lines);
  const display = lines.length === 0 ? "—" : `${lines.length} line${lines.length === 1 ? "" : "s"}`;
  return { token, display };
}

function describeCrew(value: unknown): { token: string; display: string } {
  const ids = Array.isArray(value)
    ? value.map((id) => idString(id)).filter(Boolean).sort()
    : [];
  const display =
    ids.length === 0 ? "—" : `${ids.length} technician${ids.length === 1 ? "" : "s"}`;
  return { token: ids.join(","), display };
}

function plainParts(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((part) => {
    const row =
      part && typeof part === "object" && "toObject" in part
        ? (part as { toObject: () => Record<string, unknown> }).toObject()
        : (part as Record<string, unknown> | null);
    if (!row || typeof row !== "object") return {};
    return {
      lineType: row.lineType ?? "",
      kind: row.kind ?? "",
      partNumber: row.partNumber ?? "",
      description: row.description ?? "",
      quantity: row.quantity ?? 0,
      unitPrice: row.unitPrice ?? 0,
      amount: row.amount ?? 0,
    };
  });
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function idString(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value && "toHexString" in value) {
    return (value as { toHexString: () => string }).toHexString();
  }
  return String(value);
}

function clip(value: string): string {
  if (!value) return "—";
  return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}

function toObjectId(value: Types.ObjectId | string | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  return mongoose.isValidObjectId(value) ? new Types.ObjectId(value) : null;
}

async function resolveActorName(
  actor: WorkOrderActivityActor | null | undefined,
  actorKind: WorkOrderActivityActorKind,
): Promise<string> {
  const explicit = actor?.actorName?.trim();
  if (explicit) return explicit;
  const userId = toObjectId(actor?.actorUserId ?? null);
  if (userId) {
    const user = await User.findById(userId).select("first_name last_name email").lean();
    const name = user
      ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email
      : "";
    if (name) return name;
  }
  if (actorKind === "customer") return "Customer";
  if (actorKind === "staff") return "Staff";
  return "System";
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

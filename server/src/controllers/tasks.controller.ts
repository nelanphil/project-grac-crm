import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { InboxConversation } from "../models/mongo/InboxConversation";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { ITask, Task, TaskSource, TaskStatus } from "../models/mongo/Task";
import { User, activeUserFilter } from "../models/mongo/User";
import { publishDashboardChanged } from "../services/dashboardLive";
import {
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";

const LIST_LIMIT = 200;

function personName(
  user: { first_name?: string; last_name?: string } | null | undefined,
): string {
  if (!user) return "";
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
}

function asId(value: unknown): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  const raw = String(value);
  return Types.ObjectId.isValid(raw) ? new Types.ObjectId(raw) : null;
}

function startOfDay(date = new Date()): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

type PopulatedUser = { _id: Types.ObjectId; first_name?: string; last_name?: string };
type PopulatedCustomer = {
  _id: Types.ObjectId;
  accountName?: string;
  first?: string;
  last?: string;
};
type PopulatedConversation = { _id: Types.ObjectId; displayName?: string };

function populated<T>(value: unknown): T | null {
  if (!value || typeof value !== "object" || !("_id" in value)) return null;
  return value as T;
}

function publicTask(row: ITask | (ITask & { _id: Types.ObjectId })) {
  const assignee = populated<PopulatedUser>(row.assignedUserRef);
  const creator = populated<PopulatedUser>(row.createdByUserRef);
  const technician = populated<PopulatedUser>(row.scheduledTechnicianRef);
  const customer = populated<PopulatedCustomer>(row.customerRef);
  const conversation = populated<PopulatedConversation>(row.inboxConversationRef);
  return {
    id: String(row._id),
    title: row.title,
    description: row.description || "",
    status: row.status,
    dueAt: row.dueAt ? new Date(row.dueAt).toISOString() : null,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    assigneeId: assignee ? String(assignee._id) : asId(row.assignedUserRef)?.toString() ?? null,
    assigneeName: personName(assignee),
    createdByName: personName(creator),
    customerId: customer ? String(customer._id) : asId(row.customerRef)?.toString() ?? null,
    customerName: customer ? customerDisplayName(customer) : "",
    conversationId: conversation
      ? String(conversation._id)
      : asId(row.inboxConversationRef)?.toString() ?? null,
    conversationName: conversation?.displayName || "",
    source: row.source,
    onSchedule: Boolean(row.onSchedule),
    scheduledTechnicianId: technician
      ? String(technician._id)
      : asId(row.scheduledTechnicianRef)?.toString() ?? null,
    scheduledTechnicianName: personName(technician),
    scheduledStart: row.scheduledStart ? new Date(row.scheduledStart).toISOString() : null,
    scheduledMinutes: row.scheduledMinutes || 30,
  };
}

async function loadTask(id: string): Promise<ITask | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Task.findById(id);
}

async function present(id: Types.ObjectId, res: Response): Promise<void> {
  const row = await Task.findById(id)
    .populate("assignedUserRef", "first_name last_name")
    .populate("createdByUserRef", "first_name last_name")
    .populate("scheduledTechnicianRef", "first_name last_name")
    .populate("customerRef", "accountName first last")
    .populate("inboxConversationRef", "displayName");
  if (!row) {
    res.status(404).json({ message: "Task not found" });
    return;
  }
  res.json({ task: publicTask(row) });
}

function notifyAssignee(
  task: ITask,
  actorUserId: string | null,
  summary: string,
): void {
  if (!task.assignedUserRef) return;
  if (actorUserId && String(task.assignedUserRef) === actorUserId) return;
  logNotificationAsync({
    entityType: "task",
    action: "assigned",
    entityId: String(task._id),
    summary,
    customerRef: task.customerRef,
    actorUserId,
    recipientUserIds: [task.assignedUserRef],
    direct: true,
    metadata: {
      conversationId: task.inboxConversationRef ? String(task.inboxConversationRef) : "",
    },
  });
}

export async function listTasks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const filter: Record<string, unknown> = {};
    const assignee = String(req.query.assignee || "all");
    const status = String(req.query.status || "");
    const due = String(req.query.due || "");
    const customerId = String(req.query.customerId || "");
    const conversationId = String(req.query.conversationId || "");

    if (assignee === "me" && req.user?.id && Types.ObjectId.isValid(req.user.id)) {
      filter.assignedUserRef = new Types.ObjectId(req.user.id);
    } else if (assignee && assignee !== "all" && Types.ObjectId.isValid(assignee)) {
      filter.assignedUserRef = new Types.ObjectId(assignee);
    }
    if (customerId && Types.ObjectId.isValid(customerId)) {
      filter.customerRef = new Types.ObjectId(customerId);
    }
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      filter.inboxConversationRef = new Types.ObjectId(conversationId);
    }

    const start = startOfDay();
    const tomorrow = addDays(start, 1);
    if (due === "overdue") {
      filter.status = "open";
      filter.dueAt = { $lt: start };
    } else if (due === "today") {
      filter.status = "open";
      filter.dueAt = { $gte: start, $lt: tomorrow };
    } else if (due === "upcoming") {
      filter.status = "open";
      filter.$or = [{ dueAt: { $gte: tomorrow } }, { dueAt: null }];
    } else if (status === "open" || status === "done") {
      filter.status = status;
    }

    const rows = await Task.find(filter)
      .limit(LIST_LIMIT)
      .populate("assignedUserRef", "first_name last_name")
      .populate("createdByUserRef", "first_name last_name")
      .populate("scheduledTechnicianRef", "first_name last_name")
      .populate("customerRef", "accountName first last")
      .populate("inboxConversationRef", "displayName");
    rows.sort((left, right) => {
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
    res.json({ tasks: rows.map((row) => publicTask(row)) });
  } catch (err) {
    console.error("GET /tasks error:", err);
    res.status(500).json({ message: "Failed to list tasks" });
  }
}

export async function listTaskAssignees(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const users = await User.find({
      ...activeUserFilter,
      userType: { $ne: "customer" },
      role: { $ne: "customer" },
    })
      .select("first_name last_name")
      .sort({ first_name: 1, last_name: 1 })
      .limit(200)
      .lean();
    res.json({
      assignees: users.map((user) => ({
        id: String(user._id),
        name: personName(user) || "Staff",
      })),
    });
  } catch (err) {
    console.error("GET /tasks/assignees error:", err);
    res.status(500).json({ message: "Failed to list assignees" });
  }
}

function parseDue(value: unknown): Date | null | undefined {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

const SCHEDULE_MINUTES_MIN = 15;
const SCHEDULE_MINUTES_MAX = 480;

type ScheduleFields = {
  onSchedule: boolean;
  scheduledTechnicianRef: Types.ObjectId | null;
  scheduledStart: Date | null;
  scheduledMinutes: number;
};

function scheduleSnapshot(task: {
  onSchedule?: boolean;
  scheduledTechnicianRef?: Types.ObjectId | null;
  scheduledStart?: Date | null;
  scheduledMinutes?: number;
}): ScheduleFields {
  return {
    onSchedule: Boolean(task.onSchedule),
    scheduledTechnicianRef: asId(task.scheduledTechnicianRef),
    scheduledStart: task.scheduledStart ? new Date(task.scheduledStart) : null,
    scheduledMinutes: task.scheduledMinutes || 30,
  };
}

/** Returns null when the body does not mention a schedule field. */
async function readScheduleFields(
  body: Record<string, unknown>,
  current: ScheduleFields,
): Promise<{ error: string } | { value: ScheduleFields | null }> {
  const touches =
    "onSchedule" in body ||
    "scheduledTechnicianId" in body ||
    "scheduledStart" in body ||
    "scheduledMinutes" in body;
  if (!touches) return { value: null };

  const next: ScheduleFields = { ...current };

  if (body.onSchedule === false) {
    return {
      value: {
        onSchedule: false,
        scheduledTechnicianRef: null,
        scheduledStart: null,
        scheduledMinutes: current.scheduledMinutes,
      },
    };
  }
  if (body.onSchedule === true) next.onSchedule = true;

  if ("scheduledMinutes" in body) {
    const minutes = Number(body.scheduledMinutes);
    if (
      !Number.isInteger(minutes) ||
      minutes < SCHEDULE_MINUTES_MIN ||
      minutes > SCHEDULE_MINUTES_MAX
    ) {
      return { error: "Duration must be between 15 and 480 minutes." };
    }
    next.scheduledMinutes = minutes;
    next.onSchedule = true;
  }

  if ("scheduledTechnicianId" in body) {
    if (!body.scheduledTechnicianId) {
      next.scheduledTechnicianRef = null;
    } else {
      const technicianId = asId(body.scheduledTechnicianId);
      if (!technicianId) return { error: "Choose a technician." };
      const technician = await User.findOne({
        _id: technicianId,
        ...activeUserFilter,
        schedulable: true,
      })
        .select("_id")
        .lean();
      if (!technician) return { error: "Choose a technician who can be scheduled." };
      next.scheduledTechnicianRef = technicianId;
      next.onSchedule = true;
    }
  }

  if ("scheduledStart" in body) {
    const start = parseDue(body.scheduledStart);
    if (start === undefined) return { error: "That schedule time is not valid." };
    next.scheduledStart = start;
    if (start) next.onSchedule = true;
  }

  if (!next.onSchedule) {
    next.scheduledTechnicianRef = null;
    next.scheduledStart = null;
  }
  return { value: next };
}

function notifyScheduled(
  task: ITask,
  actorUserId: string | null,
): void {
  if (!task.onSchedule || !task.scheduledTechnicianRef || !task.scheduledStart) return;
  if (actorUserId && String(task.scheduledTechnicianRef) === actorUserId) return;
  logNotificationAsync({
    entityType: "task",
    action: "assigned",
    entityId: String(task._id),
    summary: `Task scheduled: ${task.title}`,
    customerRef: task.customerRef,
    actorUserId,
    recipientUserIds: [task.scheduledTechnicianRef],
    direct: true,
    metadata: {
      conversationId: task.inboxConversationRef ? String(task.inboxConversationRef) : "",
    },
  });
}

function scheduleChanged(before: ScheduleFields, after: ScheduleFields): boolean {
  const beforeTech = before.scheduledTechnicianRef ? String(before.scheduledTechnicianRef) : "";
  const afterTech = after.scheduledTechnicianRef ? String(after.scheduledTechnicianRef) : "";
  const beforeStart = before.scheduledStart ? before.scheduledStart.getTime() : 0;
  const afterStart = after.scheduledStart ? after.scheduledStart.getTime() : 0;
  return beforeTech !== afterTech || beforeStart !== afterStart;
}

function canCloseTask(req: AuthRequest, task: ITask): boolean {
  const userId = req.user?.id;
  if (!userId) return false;
  if (req.user?.permissions.includes("tasks:write")) return true;
  if (task.assignedUserRef && String(task.assignedUserRef) === userId) return true;
  if (task.scheduledTechnicianRef && String(task.scheduledTechnicianRef) === userId) return true;
  return false;
}

const TASK_PRESENT_POPULATE = [
  { path: "assignedUserRef", select: "first_name last_name" },
  { path: "createdByUserRef", select: "first_name last_name" },
  { path: "scheduledTechnicianRef", select: "first_name last_name" },
  { path: "customerRef", select: "accountName first last" },
  { path: "inboxConversationRef", select: "displayName" },
] as const;

export async function createTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const title = String(req.body?.title || "").trim();
    if (!title) {
      res.status(400).json({ message: "Add a title." });
      return;
    }
    const dueAt = parseDue(req.body?.dueAt);
    if (dueAt === undefined) {
      res.status(400).json({ message: "That due date is not valid." });
      return;
    }
    const creatorId = new Types.ObjectId(req.user.id);
    let assigneeId = asId(req.body?.assigneeId) || creatorId;
    const assignee = await User.findOne({ _id: assigneeId, ...activeUserFilter })
      .select("_id")
      .lean();
    if (!assignee) assigneeId = creatorId;

    let customerRef = asId(req.body?.customerId);
    let conversationRef = asId(req.body?.conversationId);
    let source: TaskSource = req.body?.source === "inbox" || conversationRef ? "inbox" : "manual";
    if (conversationRef) {
      const convo = await InboxConversation.findById(conversationRef)
        .select("customerRef")
        .lean();
      if (!convo) {
        res.status(404).json({ message: "Conversation not found" });
        return;
      }
      conversationRef = convo._id as Types.ObjectId;
      if (!customerRef && convo.customerRef) customerRef = convo.customerRef;
      source = "inbox";
    }

    const communicationRef = asId(req.body?.communicationId);
    const schedule = await readScheduleFields(req.body || {}, {
      onSchedule: false,
      scheduledTechnicianRef: null,
      scheduledStart: null,
      scheduledMinutes: 30,
    });
    if ("error" in schedule) {
      res.status(400).json({ message: schedule.error });
      return;
    }
    const placed = schedule.value;
    const task = await Task.create({
      title: title.slice(0, 200),
      description: String(req.body?.description || "").trim().slice(0, 4000),
      status: "open",
      dueAt,
      assignedUserRef: assigneeId,
      createdByUserRef: creatorId,
      customerRef,
      inboxConversationRef: conversationRef,
      sourceCommunicationRef: communicationRef,
      source,
      onSchedule: placed?.onSchedule ?? false,
      scheduledTechnicianRef: placed?.scheduledTechnicianRef ?? null,
      scheduledStart: placed?.scheduledStart ?? null,
      scheduledMinutes: placed?.scheduledMinutes ?? 30,
    });
    if (communicationRef) {
      await TwilioCommunication.updateOne(
        { _id: communicationRef },
        { $set: { followUpTaskRef: task._id, taskPromptDismissedAt: null } },
      );
    }
    notifyAssignee(task, req.user.id, `Task assigned: ${task.title}`);
    if (placed && scheduleChanged(scheduleSnapshot({}), placed)) {
      notifyScheduled(task, req.user.id);
    }
    publishDashboardChanged();
    await present(task._id, res);
  } catch (err) {
    console.error("POST /tasks error:", err);
    res.status(500).json({ message: "Failed to create the task" });
  }
}

export async function updateTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const task = await loadTask(String(req.params.id));
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    const previousAssignee = task.assignedUserRef ? String(task.assignedUserRef) : "";
    const previousSchedule = scheduleSnapshot(task);
    if (typeof req.body?.title === "string") {
      const title = req.body.title.trim();
      if (!title) {
        res.status(400).json({ message: "Add a title." });
        return;
      }
      task.title = title.slice(0, 200);
    }
    if (typeof req.body?.description === "string") {
      task.description = req.body.description.trim().slice(0, 4000);
    }
    if ("dueAt" in (req.body || {})) {
      const dueAt = parseDue(req.body.dueAt);
      if (dueAt === undefined) {
        res.status(400).json({ message: "That due date is not valid." });
        return;
      }
      task.dueAt = dueAt;
      task.lastRemindedAt = null;
    }
    if (req.body?.assigneeId) {
      const assigneeId = asId(req.body.assigneeId);
      if (!assigneeId) {
        res.status(400).json({ message: "Choose an assignee." });
        return;
      }
      const assignee = await User.findOne({ _id: assigneeId, ...activeUserFilter })
        .select("_id")
        .lean();
      if (!assignee) {
        res.status(400).json({ message: "Choose an assignee." });
        return;
      }
      task.assignedUserRef = assigneeId;
    }
    const schedule = await readScheduleFields(req.body || {}, previousSchedule);
    if ("error" in schedule) {
      res.status(400).json({ message: schedule.error });
      return;
    }
    if (schedule.value) {
      task.onSchedule = schedule.value.onSchedule;
      task.scheduledTechnicianRef = schedule.value.scheduledTechnicianRef;
      task.scheduledStart = schedule.value.scheduledStart;
      task.scheduledMinutes = schedule.value.scheduledMinutes;
    }
    const status = String(req.body?.status || "") as TaskStatus;
    if (status === "done" || status === "open") {
      task.status = status;
      if (status === "done") {
        task.completedAt = new Date();
        task.completedByUserRef = req.user?.id ? asId(req.user.id) : null;
      } else {
        task.completedAt = null;
        task.completedByUserRef = null;
      }
    }
    await task.save();
    if (task.assignedUserRef && String(task.assignedUserRef) !== previousAssignee) {
      notifyAssignee(task, req.user?.id ?? null, `Task assigned: ${task.title}`);
    }
    if (schedule.value && scheduleChanged(previousSchedule, schedule.value)) {
      notifyScheduled(task, req.user?.id ?? null);
    }
    publishDashboardChanged();
    await present(task._id, res);
  } catch (err) {
    console.error("PATCH /tasks/:id error:", err);
    res.status(500).json({ message: "Failed to update the task" });
  }
}

async function setTaskStatus(
  req: AuthRequest,
  res: Response,
  status: TaskStatus,
): Promise<void> {
  const task = await loadTask(String(req.params.id));
  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return;
  }
  if (!canCloseTask(req, task)) {
    res.status(403).json({ message: "You can't update this task." });
    return;
  }
  task.status = status;
  if (status === "done") {
    task.completedAt = new Date();
    task.completedByUserRef = req.user?.id ? asId(req.user.id) : null;
  } else {
    task.completedAt = null;
    task.completedByUserRef = null;
  }
  await task.save();
  publishDashboardChanged();
  await present(task._id, res);
}

export async function completeTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    await setTaskStatus(req, res, "done");
  } catch (err) {
    console.error("POST /tasks/:id/complete error:", err);
    res.status(500).json({ message: "Failed to complete the task" });
  }
}

export async function reopenTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    await setTaskStatus(req, res, "open");
  } catch (err) {
    console.error("POST /tasks/:id/reopen error:", err);
    res.status(500).json({ message: "Failed to reopen the task" });
  }
}

async function presentMany(rows: ITask[]) {
  await Task.populate(rows, [...TASK_PRESENT_POPULATE]);
  return rows.map((row) => publicTask(row));
}

export async function listScheduledTasks(
  userIds: Types.ObjectId[],
  start: Date,
  end: Date,
) {
  if (userIds.length === 0) return [];
  const rows = await Task.find({
    onSchedule: true,
    scheduledTechnicianRef: { $in: userIds },
    scheduledStart: { $gte: start, $lte: end },
  }).sort({ scheduledStart: 1 });
  return presentMany(rows);
}

export async function listUnscheduledScheduleTasks() {
  const rows = await Task.find({
    onSchedule: true,
    status: "open",
    $or: [{ scheduledTechnicianRef: null }, { scheduledStart: null }],
  }).sort({ createdAt: 1 });
  return presentMany(rows);
}

export async function deleteTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const task = await loadTask(String(req.params.id));
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    await task.deleteOne();
    publishDashboardChanged();
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /tasks/:id error:", err);
    res.status(500).json({ message: "Failed to delete the task" });
  }
}

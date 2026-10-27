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
    });
    if (communicationRef) {
      await TwilioCommunication.updateOne(
        { _id: communicationRef },
        { $set: { followUpTaskRef: task._id, taskPromptDismissedAt: null } },
      );
    }
    notifyAssignee(task, req.user.id, `Task assigned: ${task.title}`);
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
    publishDashboardChanged();
    await present(task._id, res);
  } catch (err) {
    console.error("PATCH /tasks/:id error:", err);
    res.status(500).json({ message: "Failed to update the task" });
  }
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

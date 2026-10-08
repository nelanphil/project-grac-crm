import { Response } from "express";
import mongoose, { FilterQuery, Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Estimate } from "../models/mongo/Estimate";
import { EstimateNote } from "../models/mongo/EstimateNote";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderNote, IReminderCompletion } from "../models/mongo/WorkOrderNote";
import { isCustomerRole } from "../utils/roles";
import { displayTicketNumber } from "../services/noteAudience";

const PAGE_SIZES = [50, 150, 250] as const;
const SORT_KEYS = ["note", "ticket", "customer", "created", "completed"] as const;
type ReminderSortKey = (typeof SORT_KEYS)[number];

type PopulatedAuthor = {
  _id: Types.ObjectId;
  first_name?: string;
  last_name?: string;
};

export interface ReminderListItem {
  id: string;
  source: "work-order" | "estimate";
  content: string;
  ticketId: string;
  ticketNumber: string;
  customerName: string;
  authorName: string;
  createdAt: string;
  completed: boolean;
}

function authorNameFrom(authorId: unknown): string {
  const author = authorId as Partial<PopulatedAuthor> | null;
  return [author?.first_name, author?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function audienceFilter(userId: Types.ObjectId): FilterQuery<{
  isReminder: boolean;
  authorId: Types.ObjectId;
  mentionUserIds: Types.ObjectId[];
}> {
  return {
    isReminder: true,
    $or: [{ authorId: userId }, { mentionUserIds: userId }],
  };
}

function compareReminders(
  a: ReminderListItem,
  b: ReminderListItem,
  sort: ReminderSortKey,
  dir: "asc" | "desc",
): number {
  const sign = dir === "asc" ? 1 : -1;
  let result = 0;
  switch (sort) {
    case "note":
      result = a.content.localeCompare(b.content, undefined, { sensitivity: "base" });
      break;
    case "ticket":
      result = a.ticketNumber.localeCompare(b.ticketNumber, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      break;
    case "customer":
      result = a.customerName.localeCompare(b.customerName, undefined, {
        sensitivity: "base",
      });
      break;
    case "completed":
      result = Number(a.completed) - Number(b.completed);
      break;
    default:
      result = a.createdAt.localeCompare(b.createdAt);
  }
  if (result === 0) result = b.createdAt.localeCompare(a.createdAt);
  return result * sign;
}

function isCompleted(
  completions: IReminderCompletion[] | undefined,
  userId: string,
): boolean {
  return (completions ?? []).some(
    (entry) => String(entry.userId) === userId && entry.completedAt,
  );
}

export async function listReminders(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user || isCustomerRole(req.user)) {
    res.status(403).json({ message: "Staff only" });
    return;
  }

  const pageRaw = Number(req.query.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const sizeRaw = Number(req.query.pageSize);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeRaw)
    ? sizeRaw
    : 50;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const sortRaw = typeof req.query.sort === "string" ? req.query.sort : "";
  const sort: ReminderSortKey = (SORT_KEYS as readonly string[]).includes(sortRaw)
    ? (sortRaw as ReminderSortKey)
    : "created";
  const dir = req.query.dir === "asc" ? "asc" : "desc";
  const showCompleted =
    req.query.showCompleted === "true" || req.query.showCompleted === "1";
  const userId = new mongoose.Types.ObjectId(req.user.id);

  try {
    const base = audienceFilter(userId);
    let workOrderQuery: FilterQuery<unknown> = base;
    let estimateQuery: FilterQuery<unknown> = base;

    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const [workOrderIds, estimateIds] = await Promise.all([
        WorkOrder.find({
          $or: [{ number: re }, { customerName: re }],
        }).distinct("_id"),
        Estimate.find({
          $or: [{ number: re }, { customerName: re }],
        }).distinct("_id"),
      ]);
      workOrderQuery = {
        $and: [
          base,
          { $or: [{ content: re }, { workOrderRef: { $in: workOrderIds } }] },
        ],
      };
      estimateQuery = {
        $and: [
          base,
          { $or: [{ content: re }, { estimateRef: { $in: estimateIds } }] },
        ],
      };
    }

    const [workOrderNotes, estimateNotes] = await Promise.all([
      WorkOrderNote.find(workOrderQuery)
        .select("content workOrderRef createdAt reminderCompletions authorId")
        .populate("authorId", "first_name last_name")
        .lean(),
      EstimateNote.find(estimateQuery)
        .select("content estimateRef createdAt reminderCompletions authorId")
        .populate("authorId", "first_name last_name")
        .lean(),
    ]);

    const workOrderIds = [
      ...new Set(workOrderNotes.map((note) => String(note.workOrderRef))),
    ];
    const estimateIds = [
      ...new Set(estimateNotes.map((note) => String(note.estimateRef))),
    ];

    const [workOrders, estimates] = await Promise.all([
      workOrderIds.length
        ? WorkOrder.find({ _id: { $in: workOrderIds } })
            .select("number legacyId customerName")
            .lean()
        : [],
      estimateIds.length
        ? Estimate.find({ _id: { $in: estimateIds } })
            .select("number customerName")
            .lean()
        : [],
    ]);

    const workOrderById = new Map(
      workOrders.map((order) => [String(order._id), order]),
    );
    const estimateById = new Map(
      estimates.map((estimate) => [String(estimate._id), estimate]),
    );

    const reminders: ReminderListItem[] = [
      ...workOrderNotes.map((note) => {
        const order = workOrderById.get(String(note.workOrderRef));
        return {
          id: String(note._id),
          source: "work-order" as const,
          content: note.content,
          ticketId: String(note.workOrderRef),
          ticketNumber: order
            ? displayTicketNumber(order)
            : String(note.workOrderRef).slice(-6),
          customerName: order?.customerName || "",
          authorName: authorNameFrom(note.authorId),
          createdAt: new Date(note.createdAt).toISOString(),
          completed: isCompleted(note.reminderCompletions, req.user!.id),
        };
      }),
      ...estimateNotes.map((note) => {
        const estimate = estimateById.get(String(note.estimateRef));
        return {
          id: String(note._id),
          source: "estimate" as const,
          content: note.content,
          ticketId: String(note.estimateRef),
          ticketNumber: estimate
            ? displayTicketNumber(estimate)
            : String(note.estimateRef).slice(-6),
          customerName: estimate?.customerName || "",
          authorName: authorNameFrom(note.authorId),
          createdAt: new Date(note.createdAt).toISOString(),
          completed: isCompleted(note.reminderCompletions, req.user!.id),
        };
      }),
    ];

    const visible = showCompleted
      ? reminders
      : reminders.filter((item) => !item.completed);
    visible.sort((a, b) => compareReminders(a, b, sort, dir));

    const total = visible.length;
    const start = (page - 1) * pageSize;
    res.json({
      reminders: visible.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /reminders error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateReminderCompleted(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user || isCustomerRole(req.user)) {
    res.status(403).json({ message: "Staff only" });
    return;
  }

  const source = String(req.params.source);
  const noteId = String(req.params.noteId);
  if (source !== "work-order" && source !== "estimate") {
    res.status(400).json({ message: "Invalid reminder source" });
    return;
  }
  if (!mongoose.Types.ObjectId.isValid(noteId)) {
    res.status(400).json({ message: "Invalid note id" });
    return;
  }
  if (typeof req.body?.completed !== "boolean") {
    res.status(400).json({ message: "completed must be a boolean" });
    return;
  }

  const userId = new mongoose.Types.ObjectId(req.user.id);
  const completed = req.body.completed as boolean;

  try {
    const note =
      source === "work-order"
        ? await WorkOrderNote.findOne({
            _id: noteId,
            isReminder: true,
            $or: [{ authorId: userId }, { mentionUserIds: userId }],
          })
        : await EstimateNote.findOne({
            _id: noteId,
            isReminder: true,
            $or: [{ authorId: userId }, { mentionUserIds: userId }],
          });
    if (!note) {
      res.status(404).json({ message: "Reminder not found" });
      return;
    }

    const completions = (note.reminderCompletions ?? []).filter(
      (entry) => String(entry.userId) !== req.user!.id,
    );
    if (completed) {
      completions.push({
        userId,
        completedAt: new Date(),
      });
    }
    note.reminderCompletions = completions;
    note.markModified("reminderCompletions");
    await note.save();

    res.json({ id: noteId, source, completed });
  } catch (err) {
    console.error("PATCH /reminders/:source/:noteId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

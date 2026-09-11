import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderNote } from "../models/mongo/WorkOrderNote";
import { NoteTemplate } from "../models/mongo/NoteTemplate";
import { User } from "../models/mongo/User";
import {
  createWorkOrderNoteSchema,
  updateWorkOrderNoteSchema,
} from "../schemas/workOrderNote.schema";
import { isDispatcherRole } from "../services/schedule.service";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";

const ADMIN_ROLES = new Set(["admin", "super-admin", "owner"]);
const STAFF_ROLES = new Set([
  "admin",
  "super-admin",
  "owner",
  "manager",
  "tech",
  "dispatcher",
  "agent",
]);

type PopulatedAuthor = {
  _id: mongoose.Types.ObjectId;
  first_name: string;
  last_name: string;
};

export type PublicWorkOrderNote = {
  _id: string;
  workOrderRef: string;
  authorId?: string;
  author?: { first_name: string; last_name: string };
  content: string;
  visibleToCustomer: boolean;
  createdAt: string;
  updatedAt: string;
};

function isAdminRole(role?: string): boolean {
  return Boolean(role && ADMIN_ROLES.has(role));
}

function isStaffRole(role?: string): boolean {
  return Boolean(role && STAFF_ROLES.has(role));
}

function hasJobsPermission(req: AuthRequest, permission: string): boolean {
  return Boolean(req.user?.permissions.includes(permission));
}

function formatNote(
  note: {
    _id: mongoose.Types.ObjectId;
    workOrderRef: mongoose.Types.ObjectId;
    authorId: mongoose.Types.ObjectId | PopulatedAuthor;
    content: string;
    visibleToCustomer: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  includeAuthor: boolean,
): PublicWorkOrderNote {
  const author =
    note.authorId instanceof mongoose.Types.ObjectId
      ? null
      : (note.authorId as PopulatedAuthor);

  const publicNote: PublicWorkOrderNote = {
    _id: note._id.toString(),
    workOrderRef: note.workOrderRef.toString(),
    content: note.content,
    visibleToCustomer: note.visibleToCustomer,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };

  if (includeAuthor) {
    publicNote.authorId = author
      ? author._id.toString()
      : note.authorId.toString();
    publicNote.author = author
      ? { first_name: author.first_name, last_name: author.last_name }
      : { first_name: "", last_name: "" };
  }

  return publicNote;
}

function asFormatted(
  note: Record<string, unknown>,
  includeAuthor: boolean,
): PublicWorkOrderNote {
  return formatNote(
    {
      _id: note._id as mongoose.Types.ObjectId,
      workOrderRef: note.workOrderRef as mongoose.Types.ObjectId,
      authorId: note.authorId as PopulatedAuthor,
      content: String(note.content ?? ""),
      visibleToCustomer: Boolean(note.visibleToCustomer),
      createdAt: note.createdAt as Date,
      updatedAt: note.updatedAt as Date,
    },
    includeAuthor,
  );
}

async function findWorkOrderOr404(
  workOrderId: string,
  res: Response,
) {
  if (!mongoose.Types.ObjectId.isValid(workOrderId)) {
    res.status(400).json({ message: "Invalid work order id" });
    return null;
  }
  const workOrder = await WorkOrder.findById(workOrderId);
  if (!workOrder) {
    res.status(404).json({ message: "Work order not found" });
    return null;
  }
  return workOrder;
}

async function canWriteNotes(
  req: AuthRequest,
  workOrder: { assignedUserRef?: mongoose.Types.ObjectId | null },
  res: Response,
): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  if (!hasJobsPermission(req, "jobs:write")) {
    res.status(403).json({ message: "Missing permission: jobs:write" });
    return false;
  }
  const dispatcher = isDispatcherRole(req.user.role);
  const isAssignee =
    workOrder.assignedUserRef &&
    String(workOrder.assignedUserRef) === req.user.id;
  if (!dispatcher && !isAssignee) {
    res.status(403).json({
      message: "You can only update jobs assigned to you",
    });
    return false;
  }
  return true;
}

async function resolveLegacyAuthorId(
  assignedUserRef?: mongoose.Types.ObjectId | null,
): Promise<mongoose.Types.ObjectId | null> {
  if (assignedUserRef) return assignedUserRef;
  const admin = await User.findOne({
    role: { $in: [...ADMIN_ROLES] },
  })
    .select("_id")
    .lean();
  return admin?._id ?? null;
}

export async function ensureLegacyWorkOrderNote(
  workOrder: {
    _id: mongoose.Types.ObjectId;
    descPerformed?: string;
    assignedUserRef?: mongoose.Types.ObjectId | null;
  },
): Promise<void> {
  const content = String(workOrder.descPerformed ?? "").trim();
  if (!content) return;
  const existing = await WorkOrderNote.exists({ workOrderRef: workOrder._id });
  if (existing) return;
  const authorId = await resolveLegacyAuthorId(workOrder.assignedUserRef);
  if (!authorId) return;
  await WorkOrderNote.create({
    workOrderRef: workOrder._id,
    authorId,
    content,
    visibleToCustomer: true,
  });
}

async function syncDescPerformedPreview(
  workOrderId: mongoose.Types.ObjectId,
): Promise<void> {
  const latest = await WorkOrderNote.findOne({
    workOrderRef: workOrderId,
    visibleToCustomer: true,
  })
    .sort({ createdAt: -1 })
    .select("content")
    .lean();
  await WorkOrder.updateOne(
    { _id: workOrderId },
    { descPerformed: latest?.content ?? "" },
  );
}

export async function listVisibleWorkOrderNotes(
  workOrderId: mongoose.Types.ObjectId | string,
): Promise<PublicWorkOrderNote[]> {
  if (!mongoose.Types.ObjectId.isValid(String(workOrderId))) return [];
  const id = new mongoose.Types.ObjectId(String(workOrderId));
  const workOrder = await WorkOrder.findById(id)
    .select("descPerformed assignedUserRef")
    .lean();
  if (workOrder) {
    await ensureLegacyWorkOrderNote({
      _id: id,
      descPerformed: workOrder.descPerformed,
      assignedUserRef: workOrder.assignedUserRef,
    });
  }
  const notes = await WorkOrderNote.find({
    workOrderRef: id,
    visibleToCustomer: true,
  })
    .sort({ createdAt: 1 })
    .lean();
  return notes.map((note) => asFormatted(note, false));
}

export async function findWorkOrderIdsMatchingNoteSearch(
  re: RegExp,
): Promise<mongoose.Types.ObjectId[]> {
  const ids = await WorkOrderNote.find({ content: re }).distinct("workOrderRef");
  return ids as mongoose.Types.ObjectId[];
}

export async function getWorkOrderNotes(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const workOrder = await findWorkOrderOr404(String(req.params.id), res);
    if (!workOrder) return;

    await ensureLegacyWorkOrderNote(workOrder);

    const staff = isStaffRole(req.user?.role);
    const query: Record<string, unknown> = { workOrderRef: workOrder._id };
    if (!staff) {
      query.visibleToCustomer = true;
    }

    const notes = await WorkOrderNote.find(query)
      .populate("authorId", "first_name last_name")
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      notes: notes.map((note) => asFormatted(note, staff)),
    });
  } catch (err) {
    console.error("GET /work-orders/:id/notes error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createWorkOrderNote(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = createWorkOrderNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const workOrder = await findWorkOrderOr404(String(req.params.id), res);
    if (!workOrder) return;
    if (!(await canWriteNotes(req, workOrder, res))) return;

    let content = parsed.data.content;
    if (parsed.data.templateId && mongoose.Types.ObjectId.isValid(parsed.data.templateId)) {
      const template = await NoteTemplate.findOne({
        _id: parsed.data.templateId,
        deletedAt: null,
        $or: [
          { scope: "global" },
          { scope: "personal", ownerId: req.user?.id },
        ],
      }).lean();
      if (template && !content) {
        content = template.body;
      }
    }

    const note = await WorkOrderNote.create({
      workOrderRef: workOrder._id,
      authorId: req.user!.id,
      content,
      visibleToCustomer: parsed.data.visibleToCustomer ?? true,
    });

    if (note.visibleToCustomer) {
      await syncDescPerformedPreview(workOrder._id);
    }

    const populated = await WorkOrderNote.findById(note._id)
      .populate("authorId", "first_name last_name")
      .lean();
    if (!populated) {
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    logNotificationAsync({
      entityType: "work_order_note",
      action: "created",
      entityId: String(note._id),
      customerRef: workOrder.customerRef,
      summary: `Note added on work order ${workOrder.number || workOrder._id}`,
      metadata: { workOrderId: String(workOrder._id) },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({ note: asFormatted(populated, true) });
  } catch (err) {
    console.error("POST /work-orders/:id/notes error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateWorkOrderNote(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = updateWorkOrderNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const workOrder = await findWorkOrderOr404(String(req.params.id), res);
    if (!workOrder) return;
    if (!(await canWriteNotes(req, workOrder, res))) return;

    const noteId = String(req.params.noteId);
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      res.status(400).json({ message: "Invalid note id" });
      return;
    }

    const note = await WorkOrderNote.findOne({
      _id: noteId,
      workOrderRef: workOrder._id,
    });
    if (!note) {
      res.status(404).json({ message: "Note not found" });
      return;
    }

    const isAuthor = note.authorId.toString() === req.user!.id;
    if (!isAuthor && !isAdminRole(req.user?.role)) {
      res.status(403).json({ message: "You can only edit your own notes" });
      return;
    }

    if (parsed.data.content !== undefined) note.content = parsed.data.content;
    if (parsed.data.visibleToCustomer !== undefined) {
      note.visibleToCustomer = parsed.data.visibleToCustomer;
    }
    await note.save();
    await syncDescPerformedPreview(workOrder._id);

    const populated = await WorkOrderNote.findById(note._id)
      .populate("authorId", "first_name last_name")
      .lean();
    if (!populated) {
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    logNotificationAsync({
      entityType: "work_order_note",
      action: "updated",
      entityId: String(note._id),
      customerRef: workOrder.customerRef,
      summary: `Note updated on work order ${workOrder.number || workOrder._id}`,
      metadata: { workOrderId: String(workOrder._id) },
      ...actorFromRequest(req.user),
    });

    res.json({ note: asFormatted(populated, true) });
  } catch (err) {
    console.error("PATCH /work-orders/:id/notes/:noteId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteWorkOrderNote(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const workOrder = await findWorkOrderOr404(String(req.params.id), res);
    if (!workOrder) return;
    if (!(await canWriteNotes(req, workOrder, res))) return;

    const noteId = String(req.params.noteId);
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      res.status(400).json({ message: "Invalid note id" });
      return;
    }

    const note = await WorkOrderNote.findOne({
      _id: noteId,
      workOrderRef: workOrder._id,
    });
    if (!note) {
      res.status(404).json({ message: "Note not found" });
      return;
    }

    const isAuthor = note.authorId.toString() === req.user!.id;
    if (!isAuthor && !isAdminRole(req.user?.role)) {
      res.status(403).json({ message: "You can only delete your own notes" });
      return;
    }

    await note.deleteOne();
    await syncDescPerformedPreview(workOrder._id);

    logNotificationAsync({
      entityType: "work_order_note",
      action: "deleted",
      entityId: noteId,
      customerRef: workOrder.customerRef,
      summary: `Note deleted on work order ${workOrder.number || workOrder._id}`,
      metadata: { workOrderId: String(workOrder._id) },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /work-orders/:id/notes/:noteId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

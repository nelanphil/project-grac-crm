import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Estimate } from "../models/mongo/Estimate";
import { EstimateNote } from "../models/mongo/EstimateNote";
import { NoteTemplate } from "../models/mongo/NoteTemplate";
import {
  createEstimateNoteSchema,
  updateEstimateNoteSchema,
} from "../schemas/estimateNote.schema";
import { isAdminRole, isStaffRole } from "../utils/roles";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  createAudience,
  displayTicketNumber,
  editAudience,
  notifyNoteAudience,
  readMentionIds,
  readMentions,
  sanitizeMentionUserIds,
  type NoteMention,
} from "../services/noteAudience";

type PopulatedAuthor = {
  _id: mongoose.Types.ObjectId;
  first_name: string;
  last_name: string;
};

export type PublicEstimateNote = {
  _id: string;
  estimateRef: string;
  authorId?: string;
  author?: { first_name: string; last_name: string };
  content: string;
  visibleToCustomer: boolean;
  isReminder?: boolean;
  mentionUserIds?: string[];
  mentions?: NoteMention[];
  createdAt: string;
  updatedAt: string;
};

function formatNote(
  note: {
    _id: mongoose.Types.ObjectId;
    estimateRef: mongoose.Types.ObjectId;
    authorId: mongoose.Types.ObjectId | PopulatedAuthor;
    content: string;
    visibleToCustomer: boolean;
    isReminder?: boolean;
    mentionUserIds?: unknown;
    createdAt: Date;
    updatedAt: Date;
  },
  includeAuthor: boolean,
): PublicEstimateNote {
  const author =
    note.authorId instanceof mongoose.Types.ObjectId
      ? null
      : (note.authorId as PopulatedAuthor);

  const publicNote: PublicEstimateNote = {
    _id: note._id.toString(),
    estimateRef: note.estimateRef.toString(),
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
    publicNote.isReminder = Boolean(note.isReminder);
    publicNote.mentionUserIds = readMentionIds(note.mentionUserIds);
    publicNote.mentions = readMentions(note.mentionUserIds);
  }

  return publicNote;
}

function asFormatted(
  note: Record<string, unknown>,
  includeAuthor: boolean,
): PublicEstimateNote {
  return formatNote(
    {
      _id: note._id as mongoose.Types.ObjectId,
      estimateRef: note.estimateRef as mongoose.Types.ObjectId,
      authorId: note.authorId as PopulatedAuthor,
      content: String(note.content ?? ""),
      visibleToCustomer: Boolean(note.visibleToCustomer),
      isReminder: Boolean(note.isReminder),
      mentionUserIds: note.mentionUserIds,
      createdAt: note.createdAt as Date,
      updatedAt: note.updatedAt as Date,
    },
    includeAuthor,
  );
}

async function findEstimateOr404(estimateId: string, res: Response) {
  if (!mongoose.Types.ObjectId.isValid(estimateId)) {
    res.status(400).json({ message: "Invalid estimate id" });
    return null;
  }
  const estimate = await Estimate.findById(estimateId);
  if (!estimate) {
    res.status(404).json({ message: "Estimate not found" });
    return null;
  }
  return estimate;
}

export async function getEstimateNotes(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const estimate = await findEstimateOr404(String(req.params.id), res);
    if (!estimate) return;

    const staff = isStaffRole(req.user);
    const query: Record<string, unknown> = { estimateRef: estimate._id };
    if (!staff) query.visibleToCustomer = true;

    const notes = await EstimateNote.find(query)
      .populate("authorId", "first_name last_name")
      .populate("mentionUserIds", "first_name last_name")
      .sort({ createdAt: 1 })
      .lean();

    res.json({ notes: notes.map((note) => asFormatted(note, staff)) });
  } catch (err) {
    console.error("GET /estimates/:id/notes error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createEstimateNote(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = createEstimateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const estimate = await findEstimateOr404(String(req.params.id), res);
    if (!estimate) return;

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
      if (template && !content) content = template.body;
    }

    const mentionUserIds = await sanitizeMentionUserIds(parsed.data.mentionUserIds);
    const isReminder = parsed.data.isReminder ?? false;

    const note = await EstimateNote.create({
      estimateRef: estimate._id,
      authorId: req.user!.id,
      content,
      visibleToCustomer: parsed.data.visibleToCustomer ?? true,
      isReminder,
      mentionUserIds,
    });

    const populated = await EstimateNote.findById(note._id)
      .populate("authorId", "first_name last_name")
      .populate("mentionUserIds", "first_name last_name")
      .lean();
    if (!populated) {
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    notifyNoteAudience({
      entityType: "estimate_note",
      noteId: String(note._id),
      recipientIds: createAudience(
        req.user!.id,
        mentionUserIds.map((id) => String(id)),
        isReminder,
      ),
      isReminder,
      ticketNumber: displayTicketNumber(estimate),
      ticketId: String(estimate._id),
      customerRef: estimate.customerRef,
      customerName: estimate.customerName,
      actorUserId: req.user!.id,
    });

    logNotificationAsync({
      entityType: "estimate_note",
      action: "created",
      entityId: String(note._id),
      customerRef: estimate.customerRef,
      summary: `Note added on estimate ${estimate.number || estimate._id}`,
      metadata: { estimateId: String(estimate._id) },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({ note: asFormatted(populated, true) });
  } catch (err) {
    console.error("POST /estimates/:id/notes error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateEstimateNote(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = updateEstimateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const estimate = await findEstimateOr404(String(req.params.id), res);
    if (!estimate) return;

    const noteId = String(req.params.noteId);
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      res.status(400).json({ message: "Invalid note id" });
      return;
    }

    const note = await EstimateNote.findOne({
      _id: noteId,
      estimateRef: estimate._id,
    });
    if (!note) {
      res.status(404).json({ message: "Note not found" });
      return;
    }

    const isAuthor = note.authorId.toString() === req.user!.id;
    if (!isAuthor && !isAdminRole(req.user)) {
      res.status(403).json({ message: "You can only edit your own notes" });
      return;
    }

    const prevMentionIds = (note.mentionUserIds ?? []).map((id) => String(id));
    const prevReminder = Boolean(note.isReminder);

    if (parsed.data.content !== undefined) note.content = parsed.data.content;
    if (parsed.data.visibleToCustomer !== undefined) {
      note.visibleToCustomer = parsed.data.visibleToCustomer;
    }
    if (parsed.data.isReminder !== undefined) note.isReminder = parsed.data.isReminder;
    if (parsed.data.mentionUserIds !== undefined) {
      note.mentionUserIds = await sanitizeMentionUserIds(parsed.data.mentionUserIds);
    }
    await note.save();

    const populated = await EstimateNote.findById(note._id)
      .populate("authorId", "first_name last_name")
      .populate("mentionUserIds", "first_name last_name")
      .lean();
    if (!populated) {
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    notifyNoteAudience({
      entityType: "estimate_note",
      noteId: String(note._id),
      recipientIds: editAudience({
        authorId: String(note.authorId),
        prevMentionIds,
        nextMentionIds: (note.mentionUserIds ?? []).map((id) => String(id)),
        prevReminder,
        nextReminder: Boolean(note.isReminder),
      }),
      isReminder: Boolean(note.isReminder),
      ticketNumber: displayTicketNumber(estimate),
      ticketId: String(estimate._id),
      customerRef: estimate.customerRef,
      customerName: estimate.customerName,
      actorUserId: req.user!.id,
    });

    logNotificationAsync({
      entityType: "estimate_note",
      action: "updated",
      entityId: String(note._id),
      customerRef: estimate.customerRef,
      summary: `Note updated on estimate ${estimate.number || estimate._id}`,
      metadata: { estimateId: String(estimate._id) },
      ...actorFromRequest(req.user),
    });

    res.json({ note: asFormatted(populated, true) });
  } catch (err) {
    console.error("PATCH /estimates/:id/notes/:noteId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteEstimateNote(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const estimate = await findEstimateOr404(String(req.params.id), res);
    if (!estimate) return;

    const noteId = String(req.params.noteId);
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      res.status(400).json({ message: "Invalid note id" });
      return;
    }

    const note = await EstimateNote.findOne({
      _id: noteId,
      estimateRef: estimate._id,
    });
    if (!note) {
      res.status(404).json({ message: "Note not found" });
      return;
    }

    const isAuthor = note.authorId.toString() === req.user!.id;
    if (!isAuthor && !isAdminRole(req.user)) {
      res.status(403).json({ message: "You can only delete your own notes" });
      return;
    }

    await note.deleteOne();

    logNotificationAsync({
      entityType: "estimate_note",
      action: "deleted",
      entityId: noteId,
      customerRef: estimate.customerRef,
      summary: `Note deleted on estimate ${estimate.number || estimate._id}`,
      metadata: { estimateId: String(estimate._id) },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /estimates/:id/notes/:noteId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

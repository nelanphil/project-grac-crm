import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Customer } from "../models/mongo/Customer";
import { CustomerNote } from "../models/mongo/CustomerNote";
import {
  createCustomerNoteSchema,
  updateCustomerNoteSchema,
} from "../schemas/customerNote.schema";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";

type PopulatedAuthor = {
  _id: mongoose.Types.ObjectId;
  first_name: string;
  last_name: string;
};

function formatNote(note: {
  _id: mongoose.Types.ObjectId;
  customerRef: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId | PopulatedAuthor;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  const author =
    note.authorId instanceof mongoose.Types.ObjectId
      ? null
      : (note.authorId as PopulatedAuthor);

  return {
    _id: note._id.toString(),
    customerRef: note.customerRef.toString(),
    authorId: author ? author._id.toString() : note.authorId.toString(),
    author: author
      ? { first_name: author.first_name, last_name: author.last_name }
      : { first_name: "", last_name: "" },
    content: note.content,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

async function findCustomerOr404(
  customerId: string,
  res: Response
): Promise<{ _id: mongoose.Types.ObjectId; first: string; last: string } | null> {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    res.status(400).json({ message: "Invalid customer id" });
    return null;
  }

  const customer = await Customer.findById(customerId)
    .select("_id first last")
    .lean();
  if (!customer) {
    res.status(404).json({ message: "Customer not found" });
    return null;
  }

  return customer;
}

export async function getCustomerNotes(req: AuthRequest, res: Response): Promise<void> {
  try {
    const customerId = String(req.params.id);
    const customer = await findCustomerOr404(customerId, res);
    if (!customer) return;

    const notes = await CustomerNote.find({ customerRef: customer._id })
      .populate("authorId", "first_name last_name")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      notes: notes.map((note) =>
        formatNote({
          ...note,
          _id: note._id,
          customerRef: note.customerRef,
          authorId: note.authorId as unknown as PopulatedAuthor,
          content: note.content,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        })
      ),
    });
  } catch (err) {
    console.error("GET /customers/:id/notes error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createCustomerNote(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = createCustomerNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const customerId = String(req.params.id);
    const customer = await findCustomerOr404(customerId, res);
    if (!customer) return;

    const note = await CustomerNote.create({
      customerRef: customer._id,
      authorId: req.user.id,
      content: parsed.data.content,
    });

    const populated = await CustomerNote.findById(note._id)
      .populate("authorId", "first_name last_name")
      .lean();

    if (!populated) {
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "customer_note",
      action: "created",
      entityId: String(note._id),
      customerRef: customer._id,
      summary: `Note added for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      note: formatNote({
        ...populated,
        _id: populated._id,
        customerRef: populated.customerRef,
        authorId: populated.authorId as unknown as PopulatedAuthor,
        content: populated.content,
        createdAt: populated.createdAt,
        updatedAt: populated.updatedAt,
      }),
    });
  } catch (err) {
    console.error("POST /customers/:id/notes error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateCustomerNote(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = updateCustomerNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const customerId = String(req.params.id);
    const customer = await findCustomerOr404(customerId, res);
    if (!customer) return;

    const noteId = String(req.params.noteId);
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      res.status(400).json({ message: "Invalid note id" });
      return;
    }

    const note = await CustomerNote.findOne({
      _id: noteId,
      customerRef: customer._id,
    });

    if (!note) {
      res.status(404).json({ message: "Note not found" });
      return;
    }

    if (note.authorId.toString() !== req.user.id) {
      res.status(403).json({ message: "You can only edit your own notes" });
      return;
    }

    note.content = parsed.data.content;
    await note.save();

    const populated = await CustomerNote.findById(note._id)
      .populate("authorId", "first_name last_name")
      .lean();

    if (!populated) {
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "customer_note",
      action: "updated",
      entityId: String(note._id),
      customerRef: customer._id,
      summary: `Note updated for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(200).json({
      note: formatNote({
        ...populated,
        _id: populated._id,
        customerRef: populated.customerRef,
        authorId: populated.authorId as unknown as PopulatedAuthor,
        content: populated.content,
        createdAt: populated.createdAt,
        updatedAt: populated.updatedAt,
      }),
    });
  } catch (err) {
    console.error("PATCH /customers/:id/notes/:noteId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteCustomerNote(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const customerId = String(req.params.id);
    const customer = await findCustomerOr404(customerId, res);
    if (!customer) return;

    const noteId = String(req.params.noteId);
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      res.status(400).json({ message: "Invalid note id" });
      return;
    }

    const note = await CustomerNote.findOne({
      _id: noteId,
      customerRef: customer._id,
    });

    if (!note) {
      res.status(404).json({ message: "Note not found" });
      return;
    }

    if (note.authorId.toString() !== req.user.id) {
      res.status(403).json({ message: "You can only delete your own notes" });
      return;
    }

    await note.deleteOne();

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "customer_note",
      action: "deleted",
      entityId: noteId,
      customerRef: customer._id,
      summary: `Note deleted for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /customers/:id/notes/:noteId error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

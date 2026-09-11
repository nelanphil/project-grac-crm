import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { INoteTemplate, NoteTemplate } from "../models/mongo/NoteTemplate";
import {
  createNoteTemplateSchema,
  updateNoteTemplateSchema,
} from "../schemas/noteTemplate.schema";

const ADMIN_ROLES = new Set(["admin", "super-admin", "owner"]);

function isAdminRole(role?: string): boolean {
  return Boolean(role && ADMIN_ROLES.has(role));
}

function toPublic(doc: INoteTemplate | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof (doc as INoteTemplate).toObject === "function"
      ? (doc as INoteTemplate).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    name: d.name,
    body: d.body ?? "",
    scope: d.scope,
    ownerId: d.ownerId ? String(d.ownerId) : null,
    deletedAt: d.deletedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getNoteTemplates(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const templates = await NoteTemplate.find({
      deletedAt: null,
      $or: [
        { scope: "global" },
        { scope: "personal", ownerId: req.user.id },
      ],
    })
      .sort({ scope: 1, name: 1 })
      .lean();
    res.json({ templates: templates.map(toPublic) });
  } catch (err) {
    console.error("GET /note-templates error:", err);
    res.status(500).json({ message: "Failed to fetch note templates" });
  }
}

export async function createNoteTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const parsed = createNoteTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const requestedScope = parsed.data.scope ?? "personal";
    if (requestedScope === "global" && !isAdminRole(req.user.role)) {
      res.status(403).json({
        message: "Only admins can create global note templates",
      });
      return;
    }

    const template = await NoteTemplate.create({
      name: parsed.data.name,
      body: parsed.data.body,
      scope: requestedScope,
      ownerId: requestedScope === "personal" ? req.user.id : null,
    });

    res.status(201).json({ template: toPublic(template) });
  } catch (err) {
    console.error("POST /note-templates error:", err);
    res.status(500).json({ message: "Failed to create note template" });
  }
}

export async function updateNoteTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const parsed = updateNoteTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid template id" });
      return;
    }

    const template = await NoteTemplate.findOne({ _id: id, deletedAt: null });
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    if (template.scope === "global") {
      if (!isAdminRole(req.user.role)) {
        res.status(403).json({
          message: "Only admins can edit global note templates",
        });
        return;
      }
    } else if (String(template.ownerId) !== req.user.id) {
      res.status(403).json({ message: "You can only edit your own templates" });
      return;
    }

    if (parsed.data.name !== undefined) template.name = parsed.data.name;
    if (parsed.data.body !== undefined) template.body = parsed.data.body;
    await template.save();

    res.json({ template: toPublic(template) });
  } catch (err) {
    console.error("PATCH /note-templates/:id error:", err);
    res.status(500).json({ message: "Failed to update note template" });
  }
}

export async function deleteNoteTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "Invalid template id" });
      return;
    }

    const template = await NoteTemplate.findOne({ _id: id, deletedAt: null });
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    if (template.scope === "global") {
      if (!isAdminRole(req.user.role)) {
        res.status(403).json({
          message: "Only admins can delete global note templates",
        });
        return;
      }
    } else if (String(template.ownerId) !== req.user.id) {
      res.status(403).json({
        message: "You can only delete your own templates",
      });
      return;
    }

    template.deletedAt = new Date();
    await template.save();
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /note-templates/:id error:", err);
    res.status(500).json({ message: "Failed to delete note template" });
  }
}

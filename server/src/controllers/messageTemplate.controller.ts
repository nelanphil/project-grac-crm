import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  MessageTemplate,
  IMessageTemplate,
  slugifyMessageTemplateName,
  uniqueMessageTemplateSlug,
} from "../models/mongo/MessageTemplate";
import {
  createMessageTemplateSchema,
  updateMessageTemplateSchema,
} from "../schemas/messageTemplate.schema";

function toPublic(doc: IMessageTemplate | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IMessageTemplate).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    name: d.name,
    slug: d.slug,
    body: d.body ?? "",
    deletedAt: d.deletedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// GET /message-templates
export async function getMessageTemplates(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const includeDeleted =
      req.query.includeDeleted === "1" || req.query.includeDeleted === "true";

    const filter = includeDeleted ? {} : { deletedAt: null };
    const templates = await MessageTemplate.find(filter)
      .sort({ name: 1 })
      .lean();

    res.json({ templates: templates.map(toPublic) });
  } catch (err) {
    console.error("GET /message-templates error:", err);
    res.status(500).json({ message: "Failed to fetch message templates" });
  }
}

// GET /message-templates/:id
export async function getMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await MessageTemplate.findById(req.params.id).lean();
    if (!template || template.deletedAt) {
      res.status(404).json({ message: "Message template not found" });
      return;
    }
    res.json({ template: toPublic(template) });
  } catch (err) {
    console.error("GET /message-templates/:id error:", err);
    res.status(500).json({ message: "Failed to fetch message template" });
  }
}

// POST /message-templates
export async function createMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createMessageTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const slug =
      data.slug ??
      (await uniqueMessageTemplateSlug(
        slugifyMessageTemplateName(data.name) || "message",
      ));

    const existing = await MessageTemplate.findOne({ slug });
    if (existing) {
      if (existing.deletedAt) {
        existing.deletedAt = null;
        existing.name = data.name;
        existing.body = data.body ?? "";
        await existing.save();
        res.status(200).json({ template: toPublic(existing) });
        return;
      }
      res.status(409).json({
        message: "A message template with that slug already exists",
      });
      return;
    }

    const template = await MessageTemplate.create({
      name: data.name,
      slug,
      body: data.body ?? "",
      deletedAt: null,
    });

    res.status(201).json({ template: toPublic(template) });
  } catch (err) {
    console.error("POST /message-templates error:", err);
    res.status(500).json({ message: "Failed to create message template" });
  }
}

// PATCH /message-templates/:id
export async function updateMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateMessageTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const template = await MessageTemplate.findById(req.params.id);
    if (!template || template.deletedAt) {
      res.status(404).json({ message: "Message template not found" });
      return;
    }

    if (parsed.data.name !== undefined) template.name = parsed.data.name;
    if (parsed.data.body !== undefined) template.body = parsed.data.body;
    await template.save();

    res.json({ template: toPublic(template) });
  } catch (err) {
    console.error("PATCH /message-templates/:id error:", err);
    res.status(500).json({ message: "Failed to update message template" });
  }
}

// DELETE /message-templates/:id (soft delete)
export async function deleteMessageTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await MessageTemplate.findById(req.params.id);
    if (!template || template.deletedAt) {
      res.status(404).json({ message: "Message template not found" });
      return;
    }

    template.deletedAt = new Date();
    await template.save();

    res.json({ message: "Message template deleted" });
  } catch (err) {
    console.error("DELETE /message-templates/:id error:", err);
    res.status(500).json({ message: "Failed to delete message template" });
  }
}

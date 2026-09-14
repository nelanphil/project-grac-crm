import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { EstimateTemplate } from "../models/mongo/EstimateTemplate";
import {
  createEstimateTemplateSchema,
  setEstimateTemplateDefaultSchema,
  updateEstimateTemplateSchema,
} from "../schemas/estimateTemplate.schema";
import {
  partsForTemplate,
  toPublicEstimateTemplate,
} from "../services/estimateTemplate";

const ADMIN_ROLES = new Set(["admin", "super-admin", "owner"]);

function isAdminRole(role?: string): boolean {
  return Boolean(role && ADMIN_ROLES.has(role));
}

async function findActiveTemplate(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return EstimateTemplate.findOne({ _id: id, deletedAt: null });
}

export async function getEstimateTemplates(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const templates = await EstimateTemplate.find({ deletedAt: null })
      .sort({ isDefault: -1, name: 1 })
      .lean();
    res.json({
      templates: templates.map((template) =>
        toPublicEstimateTemplate(template as Record<string, unknown>),
      ),
    });
  } catch (err) {
    console.error("GET /estimate-templates error:", err);
    res.status(500).json({ message: "Failed to fetch estimate templates" });
  }
}

export async function getEstimateTemplateById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await findActiveTemplate(String(req.params.id));
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json({ template: toPublicEstimateTemplate(template) });
  } catch (err) {
    console.error("GET /estimate-templates/:id error:", err);
    res.status(500).json({ message: "Failed to fetch estimate template" });
  }
}

export async function createEstimateTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const parsed = createEstimateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const template = await EstimateTemplate.create({
      name: parsed.data.name,
      descPerform: parsed.data.descPerform ?? "",
      laborHours: parsed.data.laborHours ?? 0,
      parts: partsForTemplate(parsed.data.parts),
      isDefault: false,
      createdBy: req.user.id,
    });

    res.status(201).json({ template: toPublicEstimateTemplate(template) });
  } catch (err) {
    console.error("POST /estimate-templates error:", err);
    res.status(500).json({ message: "Failed to create estimate template" });
  }
}

export async function updateEstimateTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateEstimateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const template = await findActiveTemplate(String(req.params.id));
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    if (parsed.data.name !== undefined) template.name = parsed.data.name;
    if (parsed.data.descPerform !== undefined) {
      template.descPerform = parsed.data.descPerform;
    }
    if (parsed.data.laborHours !== undefined) {
      template.laborHours = parsed.data.laborHours;
    }
    if (parsed.data.parts !== undefined) {
      template.parts = partsForTemplate(parsed.data.parts);
    }
    await template.save();

    res.json({ template: toPublicEstimateTemplate(template) });
  } catch (err) {
    console.error("PATCH /estimate-templates/:id error:", err);
    res.status(500).json({ message: "Failed to update estimate template" });
  }
}

export async function setEstimateTemplateDefault(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (!isAdminRole(req.user.role)) {
      res.status(403).json({
        message: "Only admins can set the default estimate template",
      });
      return;
    }

    const parsed = setEstimateTemplateDefaultSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const template = await findActiveTemplate(String(req.params.id));
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    if (parsed.data.isDefault) {
      await EstimateTemplate.updateMany(
        { _id: { $ne: template._id }, isDefault: true, deletedAt: null },
        { $set: { isDefault: false } },
      );
      template.isDefault = true;
    } else {
      template.isDefault = false;
    }
    await template.save();

    res.json({ template: toPublicEstimateTemplate(template) });
  } catch (err) {
    console.error("POST /estimate-templates/:id/default error:", err);
    res.status(500).json({ message: "Failed to update default template" });
  }
}

export async function deleteEstimateTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await findActiveTemplate(String(req.params.id));
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    template.deletedAt = new Date();
    template.isDefault = false;
    await template.save();
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /estimate-templates/:id error:", err);
    res.status(500).json({ message: "Failed to delete estimate template" });
  }
}

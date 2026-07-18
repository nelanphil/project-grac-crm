import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  ContractTemplate,
  IContractTemplate,
  slugifyLabel,
  uniqueSlug,
} from "../models/mongo/ContractTemplate";
import {
  createContractTemplateSchema,
  updateContractTemplateSchema,
} from "../schemas/contractTemplate.schema";

function toPublic(doc: IContractTemplate | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IContractTemplate).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    label: d.label,
    slug: d.slug,
    body: d.body ?? "",
    cost: d.cost ?? 0,
    badgeIcon: d.badgeIcon ?? "scroll-text",
    deletedAt: d.deletedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// GET /contract-templates?includeDeleted=1
export async function getContractTemplates(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const includeDeleted =
      req.query.includeDeleted === "1" || req.query.includeDeleted === "true";

    const filter = includeDeleted ? {} : { deletedAt: null };
    const templates = await ContractTemplate.find(filter)
      .sort({ label: 1 })
      .lean();

    res.json({ templates: templates.map(toPublic) });
  } catch (err) {
    console.error("GET /contract-templates error:", err);
    res.status(500).json({ message: "Failed to fetch contract templates" });
  }
}

// POST /contract-templates
export async function createContractTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createContractTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const slug =
      data.slug ?? (await uniqueSlug(slugifyLabel(data.label) || "contract"));

    const existing = await ContractTemplate.findOne({ slug });
    if (existing) {
      if (existing.deletedAt) {
        existing.deletedAt = null;
        existing.label = data.label;
        existing.body = data.body ?? "";
        existing.cost = data.cost ?? 0;
        existing.badgeIcon = data.badgeIcon ?? "scroll-text";
        await existing.save();
        res.status(200).json({ template: toPublic(existing) });
        return;
      }
      res.status(409).json({ message: "A contract template with that slug already exists" });
      return;
    }

    const template = await ContractTemplate.create({
      label: data.label,
      slug,
      body: data.body ?? "",
      cost: data.cost ?? 0,
      badgeIcon: data.badgeIcon ?? "scroll-text",
      deletedAt: null,
    });

    res.status(201).json({ template: toPublic(template) });
  } catch (err) {
    console.error("POST /contract-templates error:", err);
    res.status(500).json({ message: "Failed to create contract template" });
  }
}

// PATCH /contract-templates/:id
export async function updateContractTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateContractTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const template = await ContractTemplate.findById(req.params.id);
    if (!template) {
      res.status(404).json({ message: "Contract template not found" });
      return;
    }

    const data = parsed.data;
    if (data.label !== undefined) template.label = data.label;
    if (data.body !== undefined) template.body = data.body;
    if (data.cost !== undefined) template.cost = data.cost;
    if (data.badgeIcon !== undefined) template.badgeIcon = data.badgeIcon;

    await template.save();
    res.json({ template: toPublic(template) });
  } catch (err) {
    console.error("PATCH /contract-templates error:", err);
    res.status(500).json({ message: "Failed to update contract template" });
  }
}

// POST /contract-templates/:id/duplicate
export async function duplicateContractTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const source = await ContractTemplate.findById(req.params.id).lean();
    if (!source) {
      res.status(404).json({ message: "Contract template not found" });
      return;
    }

    const label = `Copy of ${source.label}`;
    const slug = await uniqueSlug(slugifyLabel(label) || "contract-copy");

    const template = await ContractTemplate.create({
      label,
      slug,
      body: source.body ?? "",
      cost: source.cost ?? 0,
      badgeIcon: source.badgeIcon ?? "scroll-text",
      deletedAt: null,
    });

    res.status(201).json({ template: toPublic(template) });
  } catch (err) {
    console.error("POST /contract-templates/:id/duplicate error:", err);
    res.status(500).json({ message: "Failed to duplicate contract template" });
  }
}

// DELETE /contract-templates/:id — soft delete
export async function deleteContractTemplate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const template = await ContractTemplate.findById(req.params.id);
    if (!template) {
      res.status(404).json({ message: "Contract template not found" });
      return;
    }

    if (template.deletedAt) {
      res.json({ template: toPublic(template), message: "Already deleted" });
      return;
    }

    template.deletedAt = new Date();
    await template.save();
    res.json({ template: toPublic(template), message: "Contract template deleted" });
  } catch (err) {
    console.error("DELETE /contract-templates error:", err);
    res.status(500).json({ message: "Failed to delete contract template" });
  }
}

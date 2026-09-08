import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  IWorkOrderType,
  uniqueWorkOrderTypeSlug,
  WorkOrderType,
} from "../models/mongo/WorkOrderType";
import {
  createWorkOrderTypeSchema,
  updateWorkOrderTypeSchema,
} from "../schemas/workOrderType.schema";

type PopulatedUser = {
  _id: unknown;
  first_name?: string;
  last_name?: string;
};

function isPopulatedUser(value: unknown): value is PopulatedUser {
  return Boolean(
    value &&
      typeof value === "object" &&
      "_id" in value &&
      ("first_name" in value || "last_name" in value),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findDuplicateLabel(
  label: string,
  excludeId?: string,
): Promise<boolean> {
  const filter: Record<string, unknown> = {
    deletedAt: null,
    label: { $regex: `^${escapeRegex(label)}$`, $options: "i" },
  };
  if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
    filter._id = { $ne: excludeId };
  }
  return Boolean(await WorkOrderType.exists(filter));
}

function toObjectIds(ids: string[]): mongoose.Types.ObjectId[] {
  const unique = [...new Set(ids)];
  return unique.map((id) => new mongoose.Types.ObjectId(id));
}

function toPublic(doc: IWorkOrderType | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof (doc as IWorkOrderType).toObject === "function"
      ? (doc as IWorkOrderType).toObject()
      : (doc as Record<string, unknown>);

  const raw = (d.qualifiedUserRefs ?? []) as unknown[];
  const qualifiedUsers = raw.filter(isPopulatedUser).map((user) => ({
    _id: String(user._id),
    first_name: user.first_name ?? "",
    last_name: user.last_name ?? "",
  }));
  const qualifiedUserRefs = raw.map((value) =>
    isPopulatedUser(value) ? String(value._id) : String(value),
  );

  return {
    _id: d._id,
    label: d.label,
    slug: d.slug,
    qualifiedUserRefs,
    qualifiedUsers,
    deletedAt: d.deletedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function loadPublic(id: string) {
  const doc = await WorkOrderType.findById(id)
    .populate("qualifiedUserRefs", "first_name last_name")
    .lean();
  return doc ? toPublic(doc) : null;
}

// GET /work-order-types?includeDeleted=1
export async function getWorkOrderTypes(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const includeDeleted =
      req.query.includeDeleted === "1" || req.query.includeDeleted === "true";
    const filter = includeDeleted ? {} : { deletedAt: null };
    const types = await WorkOrderType.find(filter)
      .populate("qualifiedUserRefs", "first_name last_name")
      .sort({ label: 1 })
      .lean();

    res.json({ types: types.map(toPublic) });
  } catch (err) {
    console.error("GET /work-order-types error:", err);
    res.status(500).json({ message: "Failed to fetch work order types" });
  }
}

// POST /work-order-types
export async function createWorkOrderType(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createWorkOrderTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    if (await findDuplicateLabel(data.label)) {
      res
        .status(409)
        .json({ message: "A work order type with that name already exists" });
      return;
    }

    const slug = await uniqueWorkOrderTypeSlug(data.label);
    const qualifiedUserRefs = toObjectIds(data.qualifiedUserRefs);

    const existing = await WorkOrderType.findOne({ slug });
    if (existing) {
      if (existing.deletedAt) {
        existing.deletedAt = null;
        existing.label = data.label;
        existing.qualifiedUserRefs = qualifiedUserRefs;
        await existing.save();
        const restored = await loadPublic(String(existing._id));
        res.status(200).json({ type: restored });
        return;
      }
      res
        .status(409)
        .json({ message: "A work order type with that name already exists" });
      return;
    }

    const created = await WorkOrderType.create({
      label: data.label,
      slug,
      qualifiedUserRefs,
      deletedAt: null,
    });
    const type = await loadPublic(String(created._id));
    res.status(201).json({ type });
  } catch (err) {
    console.error("POST /work-order-types error:", err);
    res.status(500).json({ message: "Failed to create work order type" });
  }
}

// PATCH /work-order-types/:id
export async function updateWorkOrderType(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateWorkOrderTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const type = await WorkOrderType.findById(req.params.id);
    if (!type || type.deletedAt) {
      res.status(404).json({ message: "Work order type not found" });
      return;
    }

    const data = parsed.data;
    if (data.label !== undefined) {
      if (await findDuplicateLabel(data.label, String(type._id))) {
        res
          .status(409)
          .json({ message: "A work order type with that name already exists" });
        return;
      }
      type.label = data.label;
    }
    if (data.qualifiedUserRefs !== undefined) {
      type.qualifiedUserRefs = toObjectIds(data.qualifiedUserRefs);
    }

    await type.save();
    const updated = await loadPublic(String(type._id));
    res.json({ type: updated });
  } catch (err) {
    console.error("PATCH /work-order-types error:", err);
    res.status(500).json({ message: "Failed to update work order type" });
  }
}

// DELETE /work-order-types/:id — soft delete
export async function deleteWorkOrderType(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const type = await WorkOrderType.findById(req.params.id).populate(
      "qualifiedUserRefs",
      "first_name last_name",
    );
    if (!type) {
      res.status(404).json({ message: "Work order type not found" });
      return;
    }

    if (type.deletedAt) {
      res.json({ type: toPublic(type), message: "Already deleted" });
      return;
    }

    type.deletedAt = new Date();
    await type.save();
    res.json({ type: toPublic(type), message: "Work order type deleted" });
  } catch (err) {
    console.error("DELETE /work-order-types error:", err);
    res.status(500).json({ message: "Failed to delete work order type" });
  }
}

import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  DiscountAppliesTo,
  DiscountCode,
  DiscountMode,
  IDiscountCode,
} from "../models/mongo/DiscountCode";
import {
  createDiscountCodeSchema,
  updateDiscountCodeSchema,
} from "../schemas/discountCode.schema";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";

function parseExpiresAt(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toPublic(doc: IDiscountCode | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof (doc as IDiscountCode).toObject === "function"
      ? (doc as IDiscountCode).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    code: String(d.code ?? "").toUpperCase(),
    label: String(d.label ?? ""),
    mode: (d.mode === "amount" ? "amount" : "percent") as DiscountMode,
    value: Number(d.value) || 0,
    active: d.active !== false,
    expiresAt: d.expiresAt ?? null,
    maxRedemptions:
      typeof d.maxRedemptions === "number" ? d.maxRedemptions : null,
    redemptionCount: Number(d.redemptionCount) || 0,
    maxRedemptionsPerCustomer:
      typeof d.maxRedemptionsPerCustomer === "number"
        ? d.maxRedemptionsPerCustomer
        : null,
    minSubtotalCents:
      typeof d.minSubtotalCents === "number" ? d.minSubtotalCents : null,
    appliesTo: Array.isArray(d.appliesTo)
      ? (d.appliesTo as DiscountAppliesTo[])
      : [],
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getDiscountCodes(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const filter: Record<string, unknown> = {};
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ code: re }, { label: re }];
    }

    const codes = await DiscountCode.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ discountCodes: codes.map(toPublic) });
  } catch (err) {
    console.error("GET /discount-codes error:", err);
    res.status(500).json({ message: "Failed to fetch discount codes" });
  }
}

export async function getDiscountCodeById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const code = await DiscountCode.findById(req.params.id).lean();
    if (!code) {
      res.status(404).json({ message: "Discount code not found" });
      return;
    }
    res.json({ discountCode: toPublic(code) });
  } catch (err) {
    console.error("GET /discount-codes/:id error:", err);
    res.status(500).json({ message: "Failed to fetch discount code" });
  }
}

export async function createDiscountCode(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createDiscountCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const existing = await DiscountCode.findOne({ code: data.code }).lean();
    if (existing) {
      res.status(409).json({ message: "A discount code with that code already exists" });
      return;
    }

    if (data.mode === "percent" && data.value > 100) {
      res.status(400).json({ message: "Percent must be between 1 and 100" });
      return;
    }

    const discountCode = await DiscountCode.create({
      code: data.code,
      label: data.label ?? "",
      mode: data.mode,
      value: data.value,
      active: data.active ?? true,
      expiresAt: parseExpiresAt(data.expiresAt),
      maxRedemptions: data.maxRedemptions ?? null,
      maxRedemptionsPerCustomer: data.maxRedemptionsPerCustomer ?? null,
      minSubtotalCents: data.minSubtotalCents ?? null,
      appliesTo: data.appliesTo ?? [],
    });

    logNotificationAsync({
      entityType: "discount_code",
      action: "created",
      entityId: String(discountCode._id),
      summary: `Discount code ${discountCode.code} created`,
      metadata: { code: discountCode.code },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({ discountCode: toPublic(discountCode) });
  } catch (err) {
    console.error("POST /discount-codes error:", err);
    res.status(500).json({ message: "Failed to create discount code" });
  }
}

export async function updateDiscountCode(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateDiscountCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const discountCode = await DiscountCode.findById(req.params.id);
    if (!discountCode) {
      res.status(404).json({ message: "Discount code not found" });
      return;
    }

    const data = parsed.data;
    if (data.code && data.code !== discountCode.code) {
      const clash = await DiscountCode.findOne({
        code: data.code,
        _id: { $ne: discountCode._id },
      }).lean();
      if (clash) {
        res.status(409).json({ message: "A discount code with that code already exists" });
        return;
      }
      discountCode.code = data.code;
    }

    const nextMode = data.mode ?? discountCode.mode;
    const nextValue = data.value ?? discountCode.value;
    if (nextMode === "percent" && nextValue > 100) {
      res.status(400).json({ message: "Percent must be between 1 and 100" });
      return;
    }

    if (data.label !== undefined) discountCode.label = data.label;
    if (data.mode !== undefined) discountCode.mode = data.mode;
    if (data.value !== undefined) discountCode.value = data.value;
    if (data.active !== undefined) discountCode.active = data.active;
    if (data.expiresAt !== undefined) {
      discountCode.expiresAt = parseExpiresAt(data.expiresAt);
    }
    if (data.maxRedemptions !== undefined) {
      discountCode.maxRedemptions = data.maxRedemptions;
    }
    if (data.maxRedemptionsPerCustomer !== undefined) {
      discountCode.maxRedemptionsPerCustomer = data.maxRedemptionsPerCustomer;
    }
    if (data.minSubtotalCents !== undefined) {
      discountCode.minSubtotalCents = data.minSubtotalCents;
    }
    if (data.appliesTo !== undefined) discountCode.appliesTo = data.appliesTo;

    await discountCode.save();

    logNotificationAsync({
      entityType: "discount_code",
      action: "updated",
      entityId: String(discountCode._id),
      summary: `Discount code ${discountCode.code} updated`,
      metadata: { code: discountCode.code },
      ...actorFromRequest(req.user),
    });

    res.json({ discountCode: toPublic(discountCode) });
  } catch (err) {
    console.error("PATCH /discount-codes/:id error:", err);
    res.status(500).json({ message: "Failed to update discount code" });
  }
}

export async function deleteDiscountCode(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const discountCode = await DiscountCode.findByIdAndDelete(req.params.id).lean();
    if (!discountCode) {
      res.status(404).json({ message: "Discount code not found" });
      return;
    }

    logNotificationAsync({
      entityType: "discount_code",
      action: "deleted",
      entityId: String(discountCode._id),
      summary: `Discount code ${discountCode.code} deleted`,
      metadata: { code: discountCode.code },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /discount-codes/:id error:", err);
    res.status(500).json({ message: "Failed to delete discount code" });
  }
}

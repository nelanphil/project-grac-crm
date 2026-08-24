import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { Estimate, ESTIMATE_STATUSES } from "../models/mongo/Estimate";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import {
  createEstimateSchema,
  updateEstimateSchema,
} from "../schemas/estimate.schema";
import { applyTicketFields } from "../services/applyTicketFields";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";
import { estimatedMinutesForWorkOrder } from "../services/schedule.service";
import { nextPrefixedNumber } from "../services/serviceTicket";

function toPublic(doc: Record<string, unknown>) {
  return {
    ...doc,
    _id: doc._id,
    customerRef: doc.customerRef?.toString?.() ?? doc.customerRef ?? null,
    addressRef: doc.addressRef?.toString?.() ?? doc.addressRef ?? null,
    equipmentRef: doc.equipmentRef?.toString?.() ?? doc.equipmentRef ?? null,
    workOrderRef: doc.workOrderRef?.toString?.() ?? doc.workOrderRef ?? null,
    contractRef: doc.contractRef?.toString?.() ?? doc.contractRef ?? null,
  };
}

async function resolveCustomer(legacyId: number) {
  return Customer.findOne({ legacyId });
}

export async function getEstimates(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status =
      typeof req.query.status === "string" ? req.query.status : "";
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10) || 50),
    );

    const filter: Record<string, unknown> = {};
    if (status && (ESTIMATE_STATUSES as readonly string[]).includes(status)) {
      filter.status = status;
    }
    if (req.query.customerId) {
      const id = parseInt(String(req.query.customerId), 10);
      if (!Number.isNaN(id)) filter.customerId = id;
    }
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { number: re },
        { tech: re },
        { descPerform: re },
        { customerName: re },
      ];
    }

    const [total, estimates] = await Promise.all([
      Estimate.countDocuments(filter),
      Estimate.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    res.json({
      estimates: estimates.map((e) => toPublic(e as Record<string, unknown>)),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("GET /estimates error:", err);
    res.status(500).json({ message: "Failed to fetch estimates" });
  }
}

export async function getEstimateById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const estimate = await Estimate.findById(req.params.id).lean();
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    res.json({ estimate: toPublic(estimate as Record<string, unknown>) });
  } catch (err) {
    console.error("GET /estimates/:id error:", err);
    res.status(500).json({ message: "Failed to fetch estimate" });
  }
}

export async function createEstimate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createEstimateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const customer = await resolveCustomer(data.customerId);
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    if (data.addressRef) {
      if (!mongoose.Types.ObjectId.isValid(data.addressRef)) {
        res.status(400).json({ message: "Invalid addressRef" });
        return;
      }
      const site = await CustomerAddress.findOne({
        _id: data.addressRef,
        customerRef: customer._id,
      }).lean();
      if (!site) {
        res
          .status(400)
          .json({ message: "addressRef must belong to the customer" });
        return;
      }
    }

    const estimate = new Estimate({
      number: await nextPrefixedNumber(Estimate, "EST"),
      status: data.status ?? "draft",
      customerId: data.customerId,
      customerRef: customer._id,
    });

    await applyTicketFields(
      estimate as unknown as Record<string, unknown>,
      data,
      customer,
    );
    await estimate.save();

    logNotificationAsync({
      entityType: "estimate",
      action: "created",
      entityId: String(estimate._id),
      customerRef: customer._id,
      summary: `Estimate ${estimate.number} created for ${customerDisplayName(customer)}`,
      metadata: { number: estimate.number },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      estimate: toPublic(estimate.toObject() as unknown as Record<string, unknown>),
    });
  } catch (err) {
    console.error("POST /estimates error:", err);
    res.status(500).json({ message: "Failed to create estimate" });
  }
}

export async function updateEstimate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateEstimateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const estimate = await Estimate.findById(req.params.id);
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    if (estimate.status === "converted") {
      res.status(400).json({ message: "Converted estimates cannot be edited" });
      return;
    }

    const data = parsed.data;
    const customer = estimate.customerRef
      ? await Customer.findById(estimate.customerRef)
      : await Customer.findOne({ legacyId: estimate.customerId });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    if (data.status) estimate.status = data.status;
    await applyTicketFields(
      estimate as unknown as Record<string, unknown>,
      data,
      customer,
    );
    await estimate.save();

    logNotificationAsync({
      entityType: "estimate",
      action: "updated",
      entityId: String(estimate._id),
      customerRef: customer._id,
      summary: `Estimate ${estimate.number} updated`,
      metadata: { number: estimate.number },
      ...actorFromRequest(req.user),
    });

    res.json({
      estimate: toPublic(estimate.toObject() as unknown as Record<string, unknown>),
    });
  } catch (err) {
    console.error("PATCH /estimates/:id error:", err);
    res.status(500).json({ message: "Failed to update estimate" });
  }
}

export async function convertEstimate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const estimate = await Estimate.findById(req.params.id);
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    if (estimate.status === "converted" && estimate.workOrderRef) {
      const existing = await WorkOrder.findById(estimate.workOrderRef).lean();
      res.json({
        estimate: toPublic(estimate.toObject() as unknown as Record<string, unknown>),
        workOrder: existing,
      });
      return;
    }

    const customer = estimate.customerRef
      ? await Customer.findById(estimate.customerRef)
      : await Customer.findOne({ legacyId: estimate.customerId });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const workOrder = new WorkOrder({
      customerId: estimate.customerId,
      customerRef: customer._id,
      addressRef: estimate.addressRef ?? null,
      equipmentRef: estimate.equipmentRef ?? null,
      estimateRef: estimate._id,
      contractRef: estimate.contractRef ?? null,
      contractDiscount: estimate.contractDiscount ?? null,
      number: await nextPrefixedNumber(WorkOrder, "WO"),
      descPerform: estimate.descPerform,
      descPerformed: "",
      date: estimate.date ?? new Date(),
      tech: estimate.tech,
      laborHours: estimate.laborHours,
      parts: estimate.parts,
      customerName: estimate.customerName,
      customerAddress: estimate.customerAddress,
      customerCity: estimate.customerCity,
      customerZip: estimate.customerZip,
      customerPhone: estimate.customerPhone,
      customerEmail: estimate.customerEmail,
      workPhone: estimate.workPhone,
      serialNumber: estimate.serialNumber,
      generatorModel: estimate.generatorModel,
      exerciseDay: estimate.exerciseDay,
      exerciseTime: estimate.exerciseTime,
      totalParts: estimate.totalParts,
      totalLabor: estimate.totalLabor,
      laborOverridden: estimate.laborOverridden,
      miscExp: estimate.miscExp,
      subtotal: estimate.subtotal,
      shipping: estimate.shipping,
      total: estimate.total,
      signatureDataUrl: "",
      signedAt: null,
      signedByName: "",
      estimatedMinutes: estimatedMinutesForWorkOrder({
        laborHours: estimate.laborHours,
      }),
    });
    await workOrder.save();

    estimate.status = "converted";
    estimate.workOrderRef = workOrder._id as mongoose.Types.ObjectId;
    await estimate.save();

    logNotificationAsync({
      entityType: "estimate",
      action: "updated",
      entityId: String(estimate._id),
      customerRef: customer._id,
      summary: `Estimate ${estimate.number} converted to ${workOrder.number}`,
      metadata: { number: estimate.number, workOrderNumber: workOrder.number },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({
      estimate: toPublic(estimate.toObject() as unknown as Record<string, unknown>),
      workOrder: workOrder.toObject(),
    });
  } catch (err) {
    console.error("POST /estimates/:id/convert error:", err);
    res.status(500).json({ message: "Failed to convert estimate" });
  }
}

export async function deleteEstimate(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const estimate = await Estimate.findByIdAndDelete(req.params.id).lean();
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }

    logNotificationAsync({
      entityType: "estimate",
      action: "deleted",
      entityId: String(estimate._id),
      customerRef: estimate.customerRef ?? null,
      summary: `Estimate ${estimate.number} deleted`,
      metadata: { number: estimate.number },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /estimates/:id error:", err);
    res.status(500).json({ message: "Failed to delete estimate" });
  }
}

import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";

// GET /work-orders?customerId=<legacyId>
export async function getWorkOrders(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const filter: Record<string, unknown> = {};

    if (req.query.customerId) {
      const id = parseInt(req.query.customerId as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ message: "Invalid customerId" });
        return;
      }
      filter.customerId = id;
    }

    const workOrders = await WorkOrder.find(filter).sort({ date: -1 }).lean();

    res.json(workOrders);
  } catch {
    res.status(500).json({ message: "Failed to fetch work orders" });
  }
}

// GET /work-orders/:id
export async function getWorkOrderById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const workOrder = await WorkOrder.findById(req.params.id).lean();
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }
    res.json(workOrder);
  } catch {
    res.status(500).json({ message: "Failed to fetch work order" });
  }
}

// GET /work-orders/by-customer/:customerId  (resolve via Customer.legacyId)
export async function getWorkOrdersByCustomer(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const legacyId = parseInt(req.params.customerId, 10);
    if (isNaN(legacyId)) {
      res.status(400).json({ message: "Invalid customerId" });
      return;
    }

    const customer = await Customer.findOne({ legacyId }).lean();
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const workOrders = await WorkOrder.find({ customerId: legacyId })
      .sort({ date: -1 })
      .lean();

    res.json({ customer, workOrders });
  } catch {
    res
      .status(500)
      .json({ message: "Failed to fetch work orders for customer" });
  }
}

// POST /work-orders
export async function createWorkOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const { customerId, ...rest } = req.body;
    if (!customerId) {
      res.status(400).json({ message: "customerId is required" });
      return;
    }

    const customer = await Customer.findOne({ legacyId: customerId }).lean();
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const workOrder = await WorkOrder.create({
      customerId,
      customerRef: customer._id,
      userId: req.user ? parseInt(req.user.id, 10) : undefined,
      ...rest,
    });

    res.status(201).json(workOrder);
  } catch {
    res.status(500).json({ message: "Failed to create work order" });
  }
}

// PATCH /work-orders/:id
export async function updateWorkOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const workOrder = await WorkOrder.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true },
    ).lean();

    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    res.json(workOrder);
  } catch {
    res.status(500).json({ message: "Failed to update work order" });
  }
}

// DELETE /work-orders/:id
export async function deleteWorkOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const workOrder = await WorkOrder.findByIdAndDelete(req.params.id).lean();
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }
    res.status(204).send();
  } catch {
    res.status(500).json({ message: "Failed to delete work order" });
  }
}

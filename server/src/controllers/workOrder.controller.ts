import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";

async function enrichWithAddress(
  workOrders: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const addressIds = [
    ...new Set(
      workOrders
        .map((wo) => wo.addressRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  if (addressIds.length === 0) {
    return workOrders.map((wo) => ({ ...wo, address: null }));
  }

  const addresses = await CustomerAddress.find({ _id: { $in: addressIds } })
    .select("_id label address city state zip isPrimary")
    .lean();

  const byId = new Map(
    addresses.map((a) => [
      a._id.toString(),
      {
        _id: a._id.toString(),
        label: a.label,
        address: a.address,
        city: a.city,
        state: a.state,
        zip: a.zip,
        isPrimary: a.isPrimary,
      },
    ]),
  );

  return workOrders.map((wo) => ({
    ...wo,
    address: byId.get(wo.addressRef?.toString() ?? "") ?? null,
  }));
}

// GET /work-orders?customerId=<legacyId>&addressId=<ObjectId>
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

    if (req.query.addressId) {
      const addressId = String(req.query.addressId);
      if (!mongoose.Types.ObjectId.isValid(addressId)) {
        res.status(400).json({ message: "Invalid addressId" });
        return;
      }
      filter.addressRef = addressId;
    }

    const workOrders = await WorkOrder.find(filter).sort({ date: -1 }).lean();
    const enriched = await enrichWithAddress(workOrders);

    res.json(enriched);
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
    const legacyId = parseInt(String(req.params.customerId), 10);
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
    const { customerId, addressRef: rawAddressRef, ...rest } = req.body;
    if (!customerId) {
      res.status(400).json({ message: "customerId is required" });
      return;
    }

    const customer = await Customer.findOne({ legacyId: customerId }).lean();
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addressRef = rawAddressRef ?? null;
    if (addressRef) {
      if (!mongoose.Types.ObjectId.isValid(String(addressRef))) {
        res.status(400).json({ message: "Invalid addressRef" });
        return;
      }
      const site = await CustomerAddress.findOne({
        _id: addressRef,
        customerRef: customer._id,
      }).lean();
      if (!site) {
        res
          .status(400)
          .json({ message: "addressRef must belong to the customer" });
        return;
      }
    }

    const workOrder = await WorkOrder.create({
      customerId,
      customerRef: customer._id,
      addressRef,
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

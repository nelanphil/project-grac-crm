import { Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.middleware";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { User, activeUserFilter } from "../models/mongo/User";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
} from "../services/notification.service";
import {
  applyAssignmentSideEffects,
  availabilityWarning,
  enrichScheduleWorkOrders,
  estimatedMinutesForWorkOrder,
  findOverlappingJob,
  isDispatcherRole,
  rangeUtc,
} from "../services/schedule.service";
import { addMinutes, formatLocalDate } from "../utils/scheduleTime";

const localDateRe = /^\d{4}-\d{2}-\d{2}$/;

const updateWorkOrderSchema = z
  .object({
    assignedUserRef: z.union([z.string(), z.null()]).optional(),
    scheduledStart: z.union([z.string(), z.null()]).optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    descPerform: z.string().optional(),
    descPerformed: z.string().optional(),
    date: z.union([z.string(), z.null()]).optional(),
    tech: z.string().optional(),
    paid: z.boolean().optional(),
    completed: z.boolean().optional(),
    certify: z.boolean().optional(),
    runHours: z.number().optional(),
    laborHours: z.number().optional(),
    totalParts: z.number().optional(),
    totalLabor: z.number().optional(),
    miscExp: z.number().optional(),
    subtotal: z.number().optional(),
    shipping: z.number().optional(),
    total: z.number().optional(),
    addressRef: z.union([z.string(), z.null()]).optional(),
  });

async function enrichWithAddress(
  workOrders: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  return enrichScheduleWorkOrders(workOrders);
}

function hasJobsPermission(req: AuthRequest, permission: string): boolean {
  return Boolean(req.user?.permissions.includes(permission));
}

// GET /work-orders?customerId=&addressId=&from=&to=&assignedUserId=&unscheduled=
export async function getWorkOrders(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    const unscheduled =
      req.query.unscheduled === "1" || req.query.unscheduled === "true";
    const assignedUserId =
      typeof req.query.assignedUserId === "string"
        ? req.query.assignedUserId
        : "";

    if ((from && !localDateRe.test(from)) || (to && !localDateRe.test(to))) {
      res.status(400).json({ message: "from and to must be YYYY-MM-DD" });
      return;
    }

    if (from || to || unscheduled || assignedUserId) {
      if (!hasJobsPermission(req, "jobs:read")) {
        res.status(403).json({ message: "Missing permission: jobs:read" });
        return;
      }
    }

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

    const dispatcher = isDispatcherRole(req.user?.role);
    let scopedUserId = assignedUserId;
    if (!dispatcher && (from || to || unscheduled || assignedUserId)) {
      scopedUserId = req.user?.id ?? "";
    }
    if (scopedUserId) {
      if (!mongoose.Types.ObjectId.isValid(scopedUserId)) {
        res.status(400).json({ message: "Invalid assignedUserId" });
        return;
      }
      filter.assignedUserRef = scopedUserId;
    }

    if (from && to) {
      const { start, end } = rangeUtc(from, to);
      // Legacy `date` values are stored as UTC midnight of the calendar day.
      const utcDateStart = new Date(`${from}T00:00:00.000Z`);
      const utcDateEnd = new Date(`${to}T23:59:59.999Z`);
      if (unscheduled) {
        filter.scheduledStart = null;
        filter.date = { $gte: utcDateStart, $lte: utcDateEnd };
      } else {
        filter.$or = [
          { scheduledStart: { $gte: start, $lte: end } },
          {
            scheduledStart: null,
            date: { $gte: utcDateStart, $lte: utcDateEnd },
          },
        ];
      }
    } else if (unscheduled) {
      filter.scheduledStart = null;
    }

    const workOrders = await WorkOrder.find(filter)
      .sort({ scheduledStart: 1, date: 1 })
      .lean();
    const enriched = await enrichWithAddress(workOrders);

    res.json(enriched);
  } catch (err) {
    console.error("GET /work-orders error:", err);
    res.status(500).json({ message: "Failed to fetch work orders" });
  }
}

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
    const [enriched] = await enrichWithAddress([workOrder]);
    res.json(enriched);
  } catch {
    res.status(500).json({ message: "Failed to fetch work order" });
  }
}

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

export async function createWorkOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!hasJobsPermission(req, "jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }

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

    const estimatedMinutes =
      typeof rest.estimatedMinutes === "number"
        ? rest.estimatedMinutes
        : DEFAULT_FROM_LABOR(rest);

    const workOrder = await WorkOrder.create({
      customerId,
      customerRef: customer._id,
      addressRef,
      userId: req.user ? parseInt(req.user.id, 10) : undefined,
      ...rest,
      estimatedMinutes,
    });

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "work_order",
      action: "created",
      entityId: String(workOrder._id),
      customerRef: customer._id,
      summary: `Work order created for ${custName}`,
      metadata: { customerName: custName },
      ...actorFromRequest(req.user),
    });

    res.status(201).json(workOrder);
  } catch {
    res.status(500).json({ message: "Failed to create work order" });
  }
}

function DEFAULT_FROM_LABOR(rest: { laborHours?: number }): number {
  return estimatedMinutesForWorkOrder({
    estimatedMinutes: undefined,
    laborHours: rest.laborHours,
  });
}

export async function updateWorkOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!hasJobsPermission(req, "jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }

    const parsed = updateWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const workOrder = await WorkOrder.findById(req.params.id);
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    const dispatcher = isDispatcherRole(req.user?.role);
    const isAssignee =
      workOrder.assignedUserRef &&
      String(workOrder.assignedUserRef) === req.user?.id;

    const assigning =
      parsed.data.assignedUserRef !== undefined ||
      parsed.data.scheduledStart !== undefined;

    if (!dispatcher) {
      if (assigning) {
        res.status(403).json({
          message: "Only dispatchers can assign or move work orders",
        });
        return;
      }
      if (!isAssignee) {
        res.status(403).json({
          message: "You can only update jobs assigned to you",
        });
        return;
      }
    }

    const rest = { ...parsed.data };
    delete rest.assignedUserRef;
    delete rest.scheduledStart;
    delete rest.estimatedMinutes;

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        (workOrder as unknown as Record<string, unknown>)[key] = value;
      }
    }

    if (parsed.data.estimatedMinutes !== undefined) {
      workOrder.estimatedMinutes = parsed.data.estimatedMinutes;
    }

    if (parsed.data.assignedUserRef !== undefined) {
      if (parsed.data.assignedUserRef === null || parsed.data.assignedUserRef === "") {
        workOrder.assignedUserRef = null;
      } else if (!mongoose.Types.ObjectId.isValid(parsed.data.assignedUserRef)) {
        res.status(400).json({ message: "Invalid assignedUserRef" });
        return;
      } else {
        workOrder.assignedUserRef = new mongoose.Types.ObjectId(
          parsed.data.assignedUserRef,
        );
      }
    }

    if (parsed.data.scheduledStart !== undefined) {
      if (parsed.data.scheduledStart === null || parsed.data.scheduledStart === "") {
        workOrder.scheduledStart = null;
        workOrder.scheduledEnd = null;
      } else {
        const start = new Date(parsed.data.scheduledStart);
        if (Number.isNaN(start.getTime())) {
          res.status(400).json({ message: "Invalid scheduledStart" });
          return;
        }
        workOrder.scheduledStart = start;
        workOrder.appointmentCanceledAt = null;
        workOrder.appointmentCanceledBy = null;
      }
    }

    const minutes = estimatedMinutesForWorkOrder(workOrder);
    workOrder.estimatedMinutes = minutes;
    if (workOrder.scheduledStart) {
      workOrder.scheduledEnd = addMinutes(workOrder.scheduledStart, minutes);
    }

    let assignee: { first_name: string; last_name: string } | null = null;
    if (workOrder.assignedUserRef) {
      const user = await User.findOne({
        _id: workOrder.assignedUserRef,
        ...activeUserFilter,
      })
        .select("first_name last_name weeklyHours scheduleExceptions")
        .lean();
      if (!user) {
        res.status(400).json({ message: "Assigned user not found" });
        return;
      }
      assignee = user;

      if (workOrder.scheduledStart && workOrder.scheduledEnd) {
        const overlap = await findOverlappingJob({
          userId: String(workOrder.assignedUserRef),
          start: workOrder.scheduledStart,
          end: workOrder.scheduledEnd,
          excludeId: String(workOrder._id),
        });
        if (overlap) {
          res.status(409).json({
            message: "This time overlaps another job for that technician",
          });
          return;
        }
      }
    }

    await applyAssignmentSideEffects(workOrder, assignee);
    await workOrder.save();

    const warnings: string[] = [];
    if (
      assignee &&
      workOrder.assignedUserRef &&
      workOrder.scheduledStart &&
      workOrder.scheduledEnd
    ) {
      const user = await User.findById(workOrder.assignedUserRef)
        .select("weeklyHours scheduleExceptions")
        .lean();
      const warn = availabilityWarning({
        weeklyHours: user?.weeklyHours,
        exceptions: user?.scheduleExceptions,
        localDate: formatLocalDate(workOrder.scheduledStart),
        start: workOrder.scheduledStart,
        end: workOrder.scheduledEnd,
      });
      if (warn) warnings.push(warn);
    }

    logNotificationAsync({
      entityType: "work_order",
      action: "updated",
      entityId: String(workOrder._id),
      customerRef: workOrder.customerRef ?? null,
      summary: "Work order updated",
      ...actorFromRequest(req.user),
    });

    const lean = workOrder.toObject() as unknown as Record<string, unknown>;
    const [enriched] = await enrichWithAddress([lean]);
    res.json({ ...enriched, warnings });
  } catch (err) {
    console.error("PATCH /work-orders/:id error:", err);
    res.status(500).json({ message: "Failed to update work order" });
  }
}

export async function cancelWorkOrderAppointment(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!hasJobsPermission(req, "jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }
    if (!isDispatcherRole(req.user?.role)) {
      res.status(403).json({
        message: "Only dispatchers can cancel appointments",
      });
      return;
    }

    const workOrder = await WorkOrder.findById(req.params.id);
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }
    if (workOrder.completed) {
      res.status(400).json({ message: "Completed work orders cannot be canceled" });
      return;
    }
    if (!workOrder.scheduledStart) {
      res.status(400).json({ message: "This work order has no appointment to cancel" });
      return;
    }

    workOrder.scheduledStart = null;
    workOrder.scheduledEnd = null;
    workOrder.assignedUserRef = null;
    workOrder.tech = "";
    workOrder.appointmentCanceledAt = new Date();
    workOrder.appointmentCanceledBy = req.user?.id
      ? new mongoose.Types.ObjectId(req.user.id)
      : null;

    await workOrder.save();

    logNotificationAsync({
      entityType: "work_order",
      action: "updated",
      entityId: String(workOrder._id),
      customerRef: workOrder.customerRef ?? null,
      summary: "Work order appointment canceled",
      ...actorFromRequest(req.user),
    });

    const lean = workOrder.toObject() as unknown as Record<string, unknown>;
    const [enriched] = await enrichWithAddress([lean]);
    res.json(enriched);
  } catch (err) {
    console.error("POST /work-orders/:id/cancel-appointment error:", err);
    res.status(500).json({ message: "Failed to cancel appointment" });
  }
}

export async function deleteWorkOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!hasJobsPermission(req, "jobs:delete")) {
      res.status(403).json({ message: "Missing permission: jobs:delete" });
      return;
    }

    const workOrder = await WorkOrder.findByIdAndDelete(req.params.id).lean();
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    logNotificationAsync({
      entityType: "work_order",
      action: "deleted",
      entityId: String(workOrder._id),
      customerRef: workOrder.customerRef ?? null,
      summary: "Work order deleted",
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch {
    res.status(500).json({ message: "Failed to delete work order" });
  }
}

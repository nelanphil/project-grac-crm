import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  includingDeletedWorkOrders,
  WorkOrder,
} from "../models/mongo/WorkOrder";
import { Estimate } from "../models/mongo/Estimate";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { User, activeUserFilter } from "../models/mongo/User";
import {
  createWorkOrderSchema,
  updateWorkOrderSchema,
} from "../schemas/workOrder.schema";
import { applyTicketFields } from "../services/applyTicketFields";
import {
  actorFromRequest,
  customerDisplayName,
  logNotificationAsync,
  logNotificationThrottledAsync,
} from "../services/notification.service";
import { publishDashboardChanged } from "../services/dashboardLive";
import {
  applyAssignmentSideEffects,
  availabilityWarning,
  enrichScheduleWorkOrders,
  estimatedMinutesForWorkOrder,
  findOverlappingJob,
  isDispatcherRole,
  rangeUtc,
  scheduleDesiredWindow,
} from "../services/schedule.service";
import { saveWorkOrderAgreements } from "../services/enrollTicketAgreements";
import { nextPrefixedNumber } from "../services/serviceTicket";
import { resolveTicketWorkOrderType } from "../services/ticketWorkOrderType";
import { syncWorkOrderInvoice } from "../services/invoice.service";
import {
  addMinutes,
  formatLocalDate,
  storedTicketDateKey,
} from "../utils/scheduleTime";
import { applyCrewIds, assigneeInFilter, crewIdStrings } from "../utils/workOrderCrew";
import { resolveCustomerRefsForAuthUser } from "../utils/resolveCustomerLogin";
import { capabilitiesForJobRoleIds } from "../utils/jobRoles";
import { hasRole } from "../utils/roles";
import { findWorkOrderIdsMatchingNoteSearch } from "./workOrderNote.controller";

const localDateRe = /^\d{4}-\d{2}-\d{2}$/;
/** Autosave patches often; one "updated" event per editor per window is enough. */
const WORK_ORDER_UPDATE_NOTIFY_WINDOW_MS = 10 * 60 * 1000;

function localDateFromBody(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return localDateRe.test(day) ? day : null;
}

function timeWindowIsInvalid(start: unknown, end: unknown): boolean {
  const startTime = typeof start === "string" ? start : "";
  const endTime = typeof end === "string" ? end : "";
  return Boolean(startTime && endTime && endTime <= startTime);
}

async function loadSchedulableAssignee(id: string): Promise<
  | {
      ok: true;
      user: {
        first_name: string;
        last_name: string;
        weeklyHours?: unknown;
        scheduleExceptions?: unknown;
      };
    }
  | { ok: false; message: string }
> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { ok: false, message: "Invalid assignedUserRef" };
  }
  const user = await User.findOne({ _id: id, ...activeUserFilter })
    .select("first_name last_name schedulable weeklyHours scheduleExceptions")
    .lean();
  if (!user) return { ok: false, message: "Assigned user not found" };
  if (!user.schedulable) {
    return {
      ok: false,
      message: "Assigned user cannot be scheduled for work orders",
    };
  }
  return { ok: true, user };
}

async function enrichWithAddress(
  workOrders: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  return enrichScheduleWorkOrders(workOrders);
}

function hasJobsPermission(req: AuthRequest, permission: string): boolean {
  return Boolean(req.user?.permissions.includes(permission));
}

async function canViewDeletedWorkOrders(req: AuthRequest): Promise<boolean> {
  if (!req.user) return false;
  if (hasRole(req.user, "admin", "super-admin")) return true;
  const caps = await capabilitiesForJobRoleIds(req.user.jobRoles);
  return caps.territoryOwner;
}

function deletedOnlyQuery(req: AuthRequest): boolean {
  return req.query.deleted === "1" || req.query.deleted === "true";
}

/**
 * Soft-deleted only. `$ne: null` also matches documents that never had the
 * field, so require a stored date.
 */
const softDeletedWorkOrderFilter = { deletedAt: { $type: "date" } } as const;

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
    const pageRaw = typeof req.query.page === "string" ? req.query.page : "";
    const paginate = Boolean(pageRaw);
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const paidFilter =
      req.query.paid === "1" || req.query.paid === "true"
        ? true
        : req.query.paid === "0" || req.query.paid === "false"
          ? false
          : undefined;
    const completedFilter =
      req.query.completed === "1" || req.query.completed === "true"
        ? true
        : req.query.completed === "0" || req.query.completed === "false"
          ? false
          : undefined;

    if ((from && !localDateRe.test(from)) || (to && !localDateRe.test(to))) {
      res.status(400).json({ message: "from and to must be YYYY-MM-DD" });
      return;
    }

    const canReadJobs = hasJobsPermission(req, "jobs:read");
    if ((from || to || unscheduled || assignedUserId || paginate) && !canReadJobs) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }

    const deletedOnly = deletedOnlyQuery(req);
    if (deletedOnly && !(await canViewDeletedWorkOrders(req))) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }

    const filter: Record<string, unknown> = {};
    if (deletedOnly) Object.assign(filter, softDeletedWorkOrderFilter);

    if (!canReadJobs) {
      const refs = await resolveCustomerRefsForAuthUser(req.user?.id ?? "");
      if (refs.length === 0) {
        res.json([]);
        return;
      }
      const customers = await Customer.find({ _id: { $in: refs } })
        .select("_id legacyId")
        .lean();
      const legacyIds = customers
        .map((c) => c.legacyId)
        .filter((id): id is number => typeof id === "number");
      const ownership: Record<string, unknown>[] = [
        { customerRef: { $in: refs } },
      ];
      if (legacyIds.length > 0) {
        ownership.push({ customerId: { $in: legacyIds } });
      }
      filter.$or = ownership;
    }

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

    const dispatcher = isDispatcherRole(req.user);
    let scopedUserId = assignedUserId;
    if (!dispatcher && (from || to || unscheduled || assignedUserId)) {
      scopedUserId = req.user?.id ?? "";
    }
    if (scopedUserId) {
      if (!mongoose.Types.ObjectId.isValid(scopedUserId)) {
        res.status(400).json({ message: "Invalid assignedUserId" });
        return;
      }
      const match = assigneeInFilter([scopedUserId]);
      filter.$and = [...((filter.$and as unknown[]) ?? []), match];
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
    } else if (from) {
      filter.date = { $gte: new Date(`${from}T00:00:00.000Z`) };
    } else if (to) {
      filter.date = { $lte: new Date(`${to}T23:59:59.999Z`) };
    }

    if (paidFilter !== undefined) filter.paid = paidFilter;
    if (completedFilter !== undefined) filter.completed = completedFilter;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const noteWorkOrderIds = await findWorkOrderIdsMatchingNoteSearch(re);
      filter.$and = [
        ...(Array.isArray(filter.$and) ? (filter.$and as object[]) : []),
        {
          $or: [
            { number: re },
            { tech: re },
            { descPerform: re },
            { descPerformed: re },
            { customerName: re },
            ...(noteWorkOrderIds.length > 0
              ? [{ _id: { $in: noteWorkOrderIds } }]
              : []),
          ],
        },
      ];
    }

    if (paginate) {
      const page = Math.max(1, parseInt(pageRaw, 10) || 1);
      const pageSize = Math.min(
        500,
        Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10) || 50),
      );
      const countQuery = WorkOrder.countDocuments(filter);
      const listQuery = WorkOrder.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize);
      const [total, workOrders, statsTotal, paidCount] = await Promise.all([
        (deletedOnly ? includingDeletedWorkOrders(countQuery) : countQuery),
        (deletedOnly ? includingDeletedWorkOrders(listQuery) : listQuery).lean(),
        WorkOrder.countDocuments({}),
        WorkOrder.countDocuments({ paid: true }),
      ]);
      const enriched = await enrichWithAddress(workOrders);
      res.json({
        workOrders: enriched,
        total,
        page,
        pageSize,
        stats: {
          total: statsTotal,
          unpaid: Math.max(0, statsTotal - paidCount),
          paid: paidCount,
        },
      });
      return;
    }

    const listQuery = WorkOrder.find(filter).sort({ scheduledStart: 1, date: 1 });
    const workOrders = await (
      deletedOnly ? includingDeletedWorkOrders(listQuery) : listQuery
    ).lean();
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
    const workOrder = await includingDeletedWorkOrders(
      WorkOrder.findById(req.params.id),
    ).lean();
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }
    if (workOrder.deletedAt && !(await canViewDeletedWorkOrders(req))) {
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

    const deletedOnly = deletedOnlyQuery(req);
    if (deletedOnly && !(await canViewDeletedWorkOrders(req))) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }

    const listQuery = WorkOrder.find({
      customerId: legacyId,
      ...(deletedOnly ? softDeletedWorkOrderFilter : {}),
    }).sort({ date: -1 });
    const workOrders = await (
      deletedOnly ? includingDeletedWorkOrders(listQuery) : listQuery
    ).lean();

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

    const parsed = createWorkOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const customer = await Customer.findOne({ legacyId: data.customerId });
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const addressRef = data.addressRef ?? null;
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
      typeof data.estimatedMinutes === "number"
        ? data.estimatedMinutes
        : estimatedMinutesForWorkOrder({
            estimatedMinutes: undefined,
            laborHours: data.laborHours,
          });

    const workOrder = new WorkOrder({
      customerId: data.customerId,
      customerRef: customer._id,
      addressRef: addressRef || null,
      userId: req.user ? parseInt(req.user.id, 10) : undefined,
      number: await nextPrefixedNumber(WorkOrder, "WO"),
      estimatedMinutes,
      estimateRef:
        data.estimateRef && mongoose.Types.ObjectId.isValid(data.estimateRef)
          ? new mongoose.Types.ObjectId(data.estimateRef)
          : null,
    });

    await applyTicketFields(
      workOrder as unknown as Record<string, unknown>,
      data,
      customer,
    );

    const typeRef = await resolveTicketWorkOrderType({
      requestedRef: data.workOrderTypeRef,
      parts: workOrder.parts,
      emptyWithoutEquipment: "service",
    });
    if (!typeRef.ok) {
      res.status(400).json({ message: typeRef.message });
      return;
    }
    workOrder.workOrderTypeRef = typeRef.ref;

    const createCrew = data.assignedUserRefs?.length
      ? data.assignedUserRefs
      : data.assignedUserRef
        ? [data.assignedUserRef]
        : [];
    if (createCrew.length > 0) {
      for (const id of createCrew) {
        const assignee = await loadSchedulableAssignee(id);
        if (!assignee.ok) {
          res.status(400).json({ message: assignee.message });
          return;
        }
      }
      applyCrewIds(workOrder, createCrew);
    }
    if (data.scheduledStart) {
      const start = new Date(data.scheduledStart);
      if (!Number.isNaN(start.getTime())) {
        workOrder.scheduledStart = start;
        workOrder.scheduledEnd = addMinutes(start, estimatedMinutes);
      }
    }

    if (timeWindowIsInvalid(workOrder.startTime, workOrder.endTime)) {
      res.status(400).json({ message: "End time must be after start time" });
      return;
    }

    await workOrder.save();

    const placementWarnings: string[] = [];
    const createdDate = storedTicketDateKey(workOrder.date);
    if (
      !workOrder.completed &&
      workOrder.assignedUserRef &&
      createdDate
    ) {
      try {
        const createdCrew = crewIdStrings(workOrder);
        const placed = await scheduleDesiredWindow({
          workOrderId: String(workOrder._id),
          userIds: createdCrew,
          date: createdDate,
          desiredStartTime: workOrder.desiredStartTime,
          desiredStartBy: workOrder.desiredStartBy,
          fallbackStartTime: workOrder.startTime,
          estimatedMinutes: workOrder.estimatedMinutes,
        });
        placementWarnings.push(...placed.warnings);
        const fresh = await WorkOrder.findById(workOrder._id);
        if (fresh) {
          workOrder.scheduledStart = fresh.scheduledStart;
          workOrder.scheduledEnd = fresh.scheduledEnd;
          workOrder.date = fresh.date;
          workOrder.startTime = fresh.startTime;
          workOrder.endTime = fresh.endTime;
          workOrder.tech = fresh.tech;
          workOrder.estimatedMinutes = fresh.estimatedMinutes;
          workOrder.assignedUserRef = fresh.assignedUserRef;
          workOrder.assignedUserRefs = fresh.assignedUserRefs;
        }
      } catch (err) {
        const status = (err as { status?: number }).status;
        const message =
          err instanceof Error ? err.message : "Could not schedule this work order";
        if (!status || status >= 500) throw err;
        placementWarnings.push(message);
      }
    }

    await saveWorkOrderAgreements(workOrder);
    await syncWorkOrderInvoice(workOrder);

    if (workOrder.estimateRef) {
      await Estimate.findByIdAndUpdate(workOrder.estimateRef, {
        status: "converted",
        workOrderRef: workOrder._id,
      });
    }

    const custName = customerDisplayName(customer);
    logNotificationAsync({
      entityType: "work_order",
      action: "created",
      entityId: String(workOrder._id),
      customerRef: customer._id,
      summary: `Work order ${workOrder.number} created for ${custName}`,
      metadata: { customerName: custName, number: workOrder.number },
      ...actorFromRequest(req.user),
    });

    const lean = workOrder.toObject() as unknown as Record<string, unknown>;
    const [enriched] = await enrichWithAddress([lean]);
    if (workOrder.scheduledStart) publishDashboardChanged();
    res.status(201).json(
      placementWarnings.length > 0
        ? { ...enriched, warnings: placementWarnings }
        : enriched,
    );
  } catch {
    res.status(500).json({ message: "Failed to create work order" });
  }
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

    let workOrder = await WorkOrder.findById(req.params.id);
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    const dispatcher = isDispatcherRole(req.user);
    const isAssignee = crewIdStrings(workOrder).includes(req.user?.id ?? "");

    const assigning =
      parsed.data.assignedUserRef !== undefined ||
      parsed.data.assignedUserRefs !== undefined ||
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

    const prevCrew = crewIdStrings(workOrder);
    const prevStartTime = workOrder.startTime ?? "";
    const prevScheduledStart = workOrder.scheduledStart
      ? new Date(workOrder.scheduledStart)
      : null;
    const prevAppointmentDate = prevScheduledStart
      ? formatLocalDate(prevScheduledStart)
      : null;
    const prevTicketDate = storedTicketDateKey(workOrder.date);

    const rest = { ...parsed.data };
    delete rest.assignedUserRef;
    delete rest.assignedUserRefs;
    delete rest.workOrderTypeRef;
    delete rest.scheduledStart;
    delete rest.estimatedMinutes;

    const customer = workOrder.customerRef
      ? await Customer.findById(workOrder.customerRef)
      : await Customer.findOne({
          legacyId: workOrder.customerId,
          deletedAt: null,
          $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
        });
    if (customer) {
      if (!workOrder.customerRef) {
        workOrder.customerRef = customer._id;
      }
      await applyTicketFields(
        workOrder as unknown as Record<string, unknown>,
        rest,
        customer,
      );
    } else {
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) {
          (workOrder as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    if (parsed.data.startTime !== undefined) {
      workOrder.startTime = parsed.data.startTime?.trim() || "";
    }
    if (parsed.data.endTime !== undefined) {
      workOrder.endTime = parsed.data.endTime?.trim() || "";
    }

    if (
      parsed.data.workOrderTypeRef !== undefined ||
      parsed.data.parts !== undefined
    ) {
      const typeRef = await resolveTicketWorkOrderType({
        requestedRef:
          parsed.data.workOrderTypeRef !== undefined
            ? parsed.data.workOrderTypeRef
            : workOrder.workOrderTypeRef?.toString() ?? null,
        parts: workOrder.parts,
        emptyWithoutEquipment: "service",
      });
      if (!typeRef.ok) {
        res.status(400).json({ message: typeRef.message });
        return;
      }
      workOrder.workOrderTypeRef = typeRef.ref;
    }

    if (parsed.data.estimatedMinutes !== undefined) {
      workOrder.estimatedMinutes = parsed.data.estimatedMinutes;
    }

    const crewWasSent =
      parsed.data.assignedUserRefs !== undefined ||
      parsed.data.assignedUserRef !== undefined;
    if (crewWasSent) {
      const nextIds =
        parsed.data.assignedUserRefs !== undefined
          ? parsed.data.assignedUserRefs
          : parsed.data.assignedUserRef
            ? [parsed.data.assignedUserRef]
            : [];
      if (nextIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        res.status(400).json({ message: "Invalid assignedUserRef" });
        return;
      }
      for (const id of nextIds) {
        const loaded = await loadSchedulableAssignee(id);
        if (!loaded.ok) {
          res.status(400).json({ message: loaded.message });
          return;
        }
      }
      applyCrewIds(workOrder, nextIds);
      if (nextIds.length === 0) workOrder.tech = "";
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

    let assignees: Array<{ first_name: string; last_name: string }> = [];
    let placedAppointment = false;
    const placementWarnings: string[] = [];
    const nextCrew = crewIdStrings(workOrder);
    if (nextCrew.length > 0) {
      const users = await User.find({
        _id: { $in: nextCrew },
        ...activeUserFilter,
      })
        .select("first_name last_name weeklyHours scheduleExceptions")
        .lean();
      const byId = new Map(users.map((user) => [String(user._id), user]));
      assignees = nextCrew
        .map((id) => byId.get(id))
        .filter((user): user is NonNullable<typeof user> => Boolean(user));
      if (assignees.length !== nextCrew.length) {
        res.status(400).json({ message: "Assigned user not found" });
        return;
      }

      const nextStartTime = workOrder.startTime ?? "";
      const requestedDate =
        parsed.data.date !== undefined
          ? localDateFromBody(
              typeof parsed.data.date === "string" ? parsed.data.date : null,
            )
          : undefined;
      const dateChanged =
        parsed.data.date !== undefined &&
        (requestedDate ?? null) !== (prevAppointmentDate ?? prevTicketDate);
      const startChanged =
        parsed.data.startTime !== undefined && nextStartTime !== prevStartTime;
      const assigneeChanged =
        crewWasSent && nextCrew.join(",") !== prevCrew.join(",");
      const nextDate =
        requestedDate !== undefined
          ? requestedDate
          : (prevAppointmentDate ?? prevTicketDate);
      if (dateChanged && !nextDate) {
        workOrder.scheduledStart = null;
        workOrder.scheduledEnd = null;
      }
      const missingSlot = !prevScheduledStart;
      const shouldPlace =
        dispatcher &&
        !workOrder.completed &&
        Boolean(nextDate) &&
        parsed.data.scheduledStart === undefined &&
        (dateChanged || startChanged || assigneeChanged || missingSlot);

      if (shouldPlace && timeWindowIsInvalid(workOrder.startTime, workOrder.endTime)) {
        res.status(400).json({ message: "End time must be after start time" });
        return;
      }

      if (!shouldPlace && workOrder.scheduledStart && workOrder.scheduledEnd) {
        for (const userId of nextCrew) {
          const overlap = await findOverlappingJob({
            userId,
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

      if (shouldPlace && nextDate) {
        await workOrder.save();
        try {
          const placed = await scheduleDesiredWindow({
            workOrderId: String(workOrder._id),
            userIds: nextCrew,
            date: nextDate,
            desiredStartTime: workOrder.desiredStartTime,
            desiredStartBy: workOrder.desiredStartBy,
            fallbackStartTime: workOrder.startTime,
            estimatedMinutes: workOrder.estimatedMinutes,
            previousStart: prevScheduledStart,
          });
          placementWarnings.push(...placed.warnings);
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status && status < 500) {
            res.status(status).json({ message: (err as Error).message });
            return;
          }
          throw err;
        }
        const fresh = await WorkOrder.findById(workOrder._id);
        if (fresh) workOrder = fresh;
        placedAppointment = true;
      }
    }

    if (!workOrder.assignedUserRef) {
      const requestedDate =
        parsed.data.date !== undefined
          ? localDateFromBody(
              typeof parsed.data.date === "string" ? parsed.data.date : null,
            )
          : undefined;
      const dateChanged =
        parsed.data.date !== undefined &&
        (requestedDate ?? null) !== (prevAppointmentDate ?? prevTicketDate);
      if (
        dateChanged ||
        (crewWasSent && crewIdStrings(workOrder).length === 0)
      ) {
        workOrder.scheduledStart = null;
        workOrder.scheduledEnd = null;
      }
    }

    if (timeWindowIsInvalid(workOrder.startTime, workOrder.endTime)) {
      res.status(400).json({ message: "End time must be after start time" });
      return;
    }

    const warnings: string[] = [...placementWarnings];
    if (!placedAppointment) {
      await applyAssignmentSideEffects(
        workOrder,
        assignees.length > 0 ? assignees : null,
      );
      await workOrder.save();
    }
    await saveWorkOrderAgreements(workOrder);
    try {
      await syncWorkOrderInvoice(workOrder);
    } catch (syncErr) {
      console.error("syncWorkOrderInvoice failed:", syncErr);
      const detail =
        syncErr instanceof Error && syncErr.message ? syncErr.message : "";
      warnings.push(
        detail
          ? `The work order was saved, but its invoice was not updated: ${detail}`
          : "The work order was saved, but its invoice was not updated.",
      );
    }

    if (workOrder.scheduledStart && workOrder.scheduledEnd && assignees.length > 0) {
      const crewUsers = await User.find({
        _id: { $in: crewIdStrings(workOrder) },
      })
        .select("first_name last_name weeklyHours scheduleExceptions")
        .lean();
      for (const user of crewUsers) {
        const warn = availabilityWarning({
          weeklyHours: user.weeklyHours,
          exceptions: user.scheduleExceptions,
          localDate: formatLocalDate(workOrder.scheduledStart),
          start: workOrder.scheduledStart,
          end: workOrder.scheduledEnd,
        });
        if (warn) warnings.push(`${user.first_name} ${user.last_name}: ${warn}`);
      }
    }

    logNotificationThrottledAsync(
      {
        entityType: "work_order",
        action: "updated",
        entityId: String(workOrder._id),
        customerRef: workOrder.customerRef ?? null,
        summary: "Work order updated",
        ...actorFromRequest(req.user),
      },
      WORK_ORDER_UPDATE_NOTIFY_WINDOW_MS,
    );

    const lean = workOrder.toObject() as unknown as Record<string, unknown>;
    const [enriched] = await enrichWithAddress([lean]);
    const nextStart = workOrder.scheduledStart
      ? new Date(workOrder.scheduledStart).getTime()
      : null;
    const previousStart = prevScheduledStart ? prevScheduledStart.getTime() : null;
    if (nextStart !== previousStart || nextCrew.join(",") !== prevCrew.join(",")) {
      publishDashboardChanged();
    }
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
    if (!isDispatcherRole(req.user)) {
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
    applyCrewIds(workOrder, []);
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
    publishDashboardChanged();
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
    if (!hasJobsPermission(req, "jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid work order id" });
      return;
    }

    const workOrder = await WorkOrder.findById(req.params.id);
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    workOrder.deletedAt = new Date();
    workOrder.deletedBy = req.user?.id
      ? new mongoose.Types.ObjectId(req.user.id)
      : null;
    await workOrder.save();

    logNotificationAsync({
      entityType: "work_order",
      action: "deleted",
      entityId: String(workOrder._id),
      customerRef: workOrder.customerRef ?? null,
      summary: "Work order deleted",
      ...actorFromRequest(req.user),
    });
    if (workOrder.scheduledStart) publishDashboardChanged();

    res.status(200).json({
      message: "Work order deleted",
      workOrder: {
        _id: String(workOrder._id),
        deletedAt: workOrder.deletedAt.toISOString(),
      },
    });
  } catch {
    res.status(500).json({ message: "Failed to delete work order" });
  }
}

export async function restoreWorkOrder(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!(await canViewDeletedWorkOrders(req))) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      res.status(400).json({ message: "Invalid work order id" });
      return;
    }

    const workOrder = await includingDeletedWorkOrders(
      WorkOrder.findOne({
        _id: req.params.id,
        ...softDeletedWorkOrderFilter,
      }),
    );
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    workOrder.deletedAt = null;
    workOrder.deletedBy = null;
    await workOrder.save();

    logNotificationAsync({
      entityType: "work_order",
      action: "updated",
      entityId: String(workOrder._id),
      customerRef: workOrder.customerRef ?? null,
      summary: "Work order restored",
      metadata: { restored: true },
      ...actorFromRequest(req.user),
    });
    if (workOrder.scheduledStart) publishDashboardChanged();

    res.status(200).json({
      message: "Work order restored",
      workOrder: {
        _id: String(workOrder._id),
        deletedAt: null,
      },
    });
  } catch (err) {
    console.error("POST /work-orders/:id/restore error:", err);
    res.status(500).json({ message: "Failed to restore work order" });
  }
}

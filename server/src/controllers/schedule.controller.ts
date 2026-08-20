import { Response } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  dayRouteForUser,
  isDispatcherRole,
  listSchedulableStaff,
  listScheduleQueue,
  suggestAssignees,
  toPublicStaff,
  enrichScheduleWorkOrders,
  rangeUtc,
} from "../services/schedule.service";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { User, activeUserFilter } from "../models/mongo/User";

const localDateRe = /^\d{4}-\d{2}-\d{2}$/;

const suggestSchema = z.object({
  workOrderId: z.string().min(1),
  date: z.string().regex(localDateRe),
  estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
});

export async function getScheduleQueue(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.permissions.includes("jobs:read")) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }

    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if ((from && !localDateRe.test(from)) || (to && !localDateRe.test(to))) {
      res.status(400).json({ message: "from and to must be YYYY-MM-DD" });
      return;
    }
    if ((from && !to) || (!from && to)) {
      res.status(400).json({ message: "from and to are required together" });
      return;
    }

    const queue = await listScheduleQueue({
      dispatcher: isDispatcherRole(req.user.role),
      userId: req.user.id,
      ...(from && to ? { from, to } : {}),
    });
    res.json(queue);
  } catch (err) {
    console.error("GET /schedule/queue error:", err);
    res.status(500).json({ message: "Failed to load schedule queue" });
  }
}

export async function getScheduleStaff(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.permissions.includes("jobs:read")) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }

    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!from || !to || !localDateRe.test(from) || !localDateRe.test(to)) {
      res.status(400).json({ message: "from and to (YYYY-MM-DD) are required" });
      return;
    }

    const dispatcher = isDispatcherRole(req.user.role);
    let staff;
    if (dispatcher) {
      staff = await listSchedulableStaff();
    } else {
      const me = await User.findOne({
        _id: req.user.id,
        ...activeUserFilter,
      })
        .select(
          "first_name last_name email role schedulable homeLocation weeklyHours scheduleExceptions",
        )
        .lean();
      staff = me ? [me] : [];
    }

    const { start, end } = rangeUtc(from, to);
    const userIds = staff.map((s) => s._id);
    const jobs =
      userIds.length === 0
        ? []
        : await WorkOrder.find({
            assignedUserRef: { $in: userIds },
            scheduledStart: { $gte: start, $lte: end },
          })
            .sort({ scheduledStart: 1 })
            .lean();

    const enriched = await enrichScheduleWorkOrders(jobs);

    res.json({
      staff: staff.map(toPublicStaff),
      workOrders: enriched,
    });
  } catch (err) {
    console.error("GET /schedule/staff error:", err);
    res.status(500).json({ message: "Failed to load schedule staff" });
  }
}

export async function postScheduleSuggest(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isDispatcherRole(req.user?.role)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }
    if (!req.user?.permissions.includes("jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }

    const parsed = suggestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const result = await suggestAssignees(parsed.data);
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status !== 500) {
      res.status(status).json({ message: (err as Error).message });
      return;
    }
    console.error("POST /schedule/suggest error:", err);
    res.status(500).json({ message: "Failed to suggest technicians" });
  }
}

export async function getScheduleRoute(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.permissions.includes("jobs:read")) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }

    const userId =
      typeof req.query.userId === "string" ? req.query.userId : req.user.id;
    const date = typeof req.query.date === "string" ? req.query.date : "";
    if (!date || !localDateRe.test(date)) {
      res.status(400).json({ message: "date (YYYY-MM-DD) is required" });
      return;
    }

    if (!isDispatcherRole(req.user.role) && userId !== req.user.id) {
      res.status(403).json({ message: "You can only view your own route" });
      return;
    }

    const result = await dayRouteForUser({ userId, date });
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status !== 500) {
      res.status(status).json({ message: (err as Error).message });
      return;
    }
    console.error("GET /schedule/route error:", err);
    res.status(500).json({ message: "Failed to load day route" });
  }
}

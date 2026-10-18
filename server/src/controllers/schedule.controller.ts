import { Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  countTechnicianJobsOnDate,
  dayRouteForUser,
  planRouteForUser,
  applyPlannedRoute,
  hydrateMissingAddressCoordinates,
  isDispatcherRole,
  listSchedulableStaff,
  listScheduleQueue,
  staffDisplayName,
  suggestAssignees,
  recommendAssignees,
  recommendTechnicianForSlot,
  placeWorkOrder,
  startOptionsForWorkOrder,
  toPublicStaff,
  enrichScheduleWorkOrders,
  rangeUtc,
} from "../services/schedule.service";
import { publishDashboardChanged } from "../services/dashboardLive";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { assigneeInFilter } from "../utils/workOrderCrew";
import { User, activeUserFilter } from "../models/mongo/User";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { env } from "../config/env";
import { formatUsPhone } from "../utils/customerSites";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import {
  getTwilioAccountForSend,
  resolveFromNumber,
  sendSms,
  TwilioServiceError,
} from "../services/twilio.service";
import { toE164 } from "../utils/messagingContext";
import { isPubliclyReachableApiHost } from "../utils/publicUrl";
import { formatScheduleSms } from "../utils/scheduleSms";
import { formatLocalDate, localDayBounds } from "../utils/scheduleTime";
import { isUsStateCode } from "../constants/usStates";
import { getActiveGoogleApiKey } from "../utils/googleAddressValidator";
import {
  resolveUsCity,
  resolveUsCityAt,
  suggestUsCities,
} from "../utils/googlePlaces";
import {
  CityBoundaryError,
  cityBoundariesForState,
} from "../services/cityBoundaries";

const localDateRe = /^\d{4}-\d{2}-\d{2}$/;

const SCHEDULE_USER_SELECT =
  "first_name last_name email role roles schedulable homeLocation weeklyHours scheduleExceptions serviceCities scheduleColor initials";

/** Self, or an active schedulable technician. */
async function scheduleUserForViewer(viewerId: string, userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { error: "invalid" as const };
  }
  const person = await User.findOne({
    _id: userId,
    ...activeUserFilter,
    ...(userId === viewerId
      ? {}
      : { userType: "staff" as const, schedulable: true }),
  })
    .select(SCHEDULE_USER_SELECT)
    .lean();
  if (!person) return { error: "forbidden" as const };
  return { person };
}

const suggestSchema = z.object({
  workOrderId: z.string().min(1),
  date: z.string().regex(localDateRe),
  estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
});

const recommendationsSchema = z.object({
  date: z.string().regex(localDateRe),
  workOrderIds: z.array(z.string().min(1)).max(200),
});

const hhmmRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const technicianRecommendationSchema = z
  .object({
    date: z.string().regex(localDateRe, "date must be YYYY-MM-DD"),
    startTime: z.string().regex(hhmmRe, "startTime must be HH:mm").optional(),
    startBy: z.string().regex(hhmmRe, "startBy must be HH:mm").optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    addressRef: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    workOrderTypeRef: z.string().optional(),
    excludeWorkOrderId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startBy && !data.startTime) {
      ctx.addIssue({
        code: "custom",
        message: "A start window needs a start time",
        path: ["startTime"],
      });
    }
    if (data.startBy && data.startTime && data.startBy <= data.startTime) {
      ctx.addIssue({
        code: "custom",
        message: "The latest start must be after the earliest start",
        path: ["startBy"],
      });
    }
    if (!data.addressRef?.trim() && !data.city?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "A city or address is required",
        path: ["city"],
      });
    }
    for (const field of ["addressRef", "workOrderTypeRef", "excludeWorkOrderId"] as const) {
      const value = data[field]?.trim();
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid ${field}`,
          path: [field],
        });
      }
    }
  });

const placeSchema = z
  .object({
    workOrderId: z.string().min(1),
    assignedUserRef: z.string().min(1).optional(),
    assignedUserRefs: z.array(z.string().min(1)).max(8).optional(),
    date: z.string().regex(localDateRe),
    scheduledStart: z.string().min(1).optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    insertIndex: z.number().int().min(0).optional(),
    requirePreferred: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const crew = data.assignedUserRefs?.length
      ? data.assignedUserRefs
      : data.assignedUserRef
        ? [data.assignedUserRef]
        : [];
    if (crew.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "assignedUserRef is required",
        path: ["assignedUserRef"],
      });
    }
    if (!data.scheduledStart && data.insertIndex === undefined && crew.length < 2) {
      ctx.addIssue({
        code: "custom",
        message: "scheduledStart or insertIndex is required",
        path: ["scheduledStart"],
      });
    }
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

    const includeUndated =
      req.query.includeUndated === "1" || req.query.includeUndated === "true";
    const queue = await listScheduleQueue({
      dispatcher: isDispatcherRole(req.user),
      userId: req.user.id,
      ...(from && to
        ? { from, to, ...(includeUndated ? { includeUndated: true } : {}) }
        : {}),
    });
    res.json(queue);
  } catch (err) {
    console.error("GET /schedule/queue error:", err);
    res.status(500).json({ message: "Failed to load schedule queue" });
  }
}

export async function getScheduleTechnicians(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const permissions = req.user?.permissions ?? [];
    if (
      !permissions.includes("jobs:read") &&
      !permissions.includes("estimates:read")
    ) {
      res.status(403).json({
        message: "Missing permission: jobs:read or estimates:read",
      });
      return;
    }

    const search = typeof req.query.search === "string" ? req.query.search : "";
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const excludeWorkOrderId =
      typeof req.query.excludeWorkOrderId === "string"
        ? req.query.excludeWorkOrderId
        : "";

    if (date && !localDateRe.test(date)) {
      res.status(400).json({ message: "date must be YYYY-MM-DD" });
      return;
    }
    if (
      excludeWorkOrderId &&
      !mongoose.Types.ObjectId.isValid(excludeWorkOrderId)
    ) {
      res.status(400).json({ message: "Invalid excludeWorkOrderId" });
      return;
    }

    const staff = await listSchedulableStaff();
    const query = search.trim().toLowerCase();
    const filtered = query
      ? staff.filter((user) =>
          staffDisplayName(user).toLowerCase().includes(query),
        )
      : staff;
    const all = req.query.all === "1";
    const limited = all ? filtered : filtered.slice(0, 8);

    const counts =
      date && limited.length > 0
        ? await countTechnicianJobsOnDate({
            userIds: limited.map((user) => user._id),
            localDate: date,
            excludeWorkOrderId: excludeWorkOrderId || undefined,
          })
        : new Map<string, number>();

    res.json({
      technicians: limited.map((user) => ({
        _id: String(user._id),
        first_name: user.first_name,
        last_name: user.last_name,
        jobsOnDate: counts.get(String(user._id)) ?? 0,
      })),
    });
  } catch (err) {
    console.error("GET /schedule/technicians error:", err);
    res.status(500).json({ message: "Failed to load technicians" });
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

    const requestedId =
      typeof req.query.userId === "string" ? req.query.userId : "";
    const dispatcher = isDispatcherRole(req.user);
    let staff;
    if (requestedId) {
      const viewed = await scheduleUserForViewer(req.user.id, requestedId);
      if (viewed.error === "invalid") {
        res.status(400).json({ message: "Invalid userId" });
        return;
      }
      if (viewed.error === "forbidden") {
        res.status(403).json({
          message: "You can only view a technician's schedule",
        });
        return;
      }
      staff = [viewed.person];
    } else if (dispatcher) {
      staff = await listSchedulableStaff();
    } else {
      const me = await User.findOne({
        _id: req.user.id,
        ...activeUserFilter,
      })
        .select(SCHEDULE_USER_SELECT)
        .lean();
      staff = me ? [me] : [];
    }

    const { start, end } = rangeUtc(from, to);
    const userIds = staff.map((s) => s._id);
    const jobs =
      userIds.length === 0
        ? []
        : await WorkOrder.find({
            ...assigneeInFilter(userIds),
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
    if (!isDispatcherRole(req.user)) {
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

export async function postScheduleRecommendations(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isDispatcherRole(req.user)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }
    if (!req.user?.permissions.includes("jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }

    const parsed = recommendationsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const result = await recommendAssignees(parsed.data);
    res.json(result);
  } catch (err) {
    console.error("POST /schedule/recommendations error:", err);
    res.status(500).json({ message: "Failed to recommend technicians" });
  }
}

export async function postScheduleTechnicianRecommendation(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const permissions = req.user?.permissions ?? [];
    if (
      !permissions.includes("jobs:read") &&
      !permissions.includes("estimates:read")
    ) {
      res.status(403).json({
        message: "Missing permission: jobs:read or estimates:read",
      });
      return;
    }

    const parsed = technicianRecommendationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const result = await recommendTechnicianForSlot(parsed.data);
    res.json(result);
  } catch (err) {
    console.error("POST /schedule/technician-recommendation error:", err);
    res.status(500).json({ message: "Failed to recommend a technician" });
  }
}

export async function postSchedulePlace(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isDispatcherRole(req.user)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }
    if (!req.user?.permissions.includes("jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }

    const parsed = placeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    let scheduledStart: Date | undefined;
    if (parsed.data.scheduledStart) {
      scheduledStart = new Date(parsed.data.scheduledStart);
      if (Number.isNaN(scheduledStart.getTime())) {
        res.status(400).json({ message: "scheduledStart must be a date" });
        return;
      }
    }

    const crew = parsed.data.assignedUserRefs?.length
      ? parsed.data.assignedUserRefs
      : parsed.data.assignedUserRef
        ? [parsed.data.assignedUserRef]
        : [];
    const result = await placeWorkOrder({
      workOrderId: parsed.data.workOrderId,
      assignedUserRef: crew[0] ?? "",
      assignedUserRefs: crew,
      date: parsed.data.date,
      scheduledStart,
      estimatedMinutes: parsed.data.estimatedMinutes,
      insertIndex: parsed.data.insertIndex,
      requirePreferred: parsed.data.requirePreferred,
    });
    publishDashboardChanged();
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status !== 500) {
      res.status(status).json({ message: (err as Error).message });
      return;
    }
    console.error("POST /schedule/place error:", err);
    res.status(500).json({ message: "Failed to place work order" });
  }
}

export async function getScheduleStartOptions(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isDispatcherRole(req.user)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }
    if (!req.user?.permissions.includes("jobs:read")) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }

    const workOrderId =
      typeof req.query.workOrderId === "string" ? req.query.workOrderId : "";
    if (!workOrderId) {
      res.status(400).json({ message: "workOrderId is required" });
      return;
    }

    const result = await startOptionsForWorkOrder(workOrderId);
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status !== 500) {
      res.status(status).json({ message: (err as Error).message });
      return;
    }
    console.error("GET /schedule/start-options error:", err);
    res.status(500).json({ message: "Failed to load start times" });
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
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ message: "Invalid userId" });
      return;
    }

    if (userId !== req.user.id) {
      const viewed = await scheduleUserForViewer(req.user.id, userId);
      if (viewed.error) {
        res.status(403).json({
          message: "You can only view a technician's route",
        });
        return;
      }
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

const lockedStopSchema = z.object({
  workOrderId: z.string().min(1),
  arrival: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid lock time",
  }),
});

const planRouteSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(localDateRe),
  workOrderIds: z.array(z.string().min(1)).max(100),
  roundTrip: z.boolean(),
  objective: z.enum(["time", "distance"]),
  optimize: z.boolean(),
  lockedStops: z.array(lockedStopSchema).max(100).optional(),
});

const applyRouteSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(localDateRe),
  orderedWorkOrderIds: z.array(z.string().min(1)).min(1).max(100),
  lockedStops: z.array(lockedStopSchema).max(100).optional(),
});

export async function postScheduleRoutePlan(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.permissions.includes("jobs:read")) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }

    const parsed = planRouteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    if (!isDispatcherRole(req.user) && parsed.data.userId !== req.user.id) {
      res.status(403).json({ message: "You can only view your own route" });
      return;
    }

    const result = await planRouteForUser(parsed.data);
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status !== 500) {
      res.status(status).json({ message: (err as Error).message });
      return;
    }
    console.error("POST /schedule/route/plan error:", err);
    res.status(500).json({ message: "Failed to plan route" });
  }
}

export async function postScheduleRouteApply(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!isDispatcherRole(req.user)) {
      res.status(403).json({ message: "Insufficient role" });
      return;
    }
    if (!req.user?.permissions.includes("jobs:write")) {
      res.status(403).json({ message: "Missing permission: jobs:write" });
      return;
    }

    const parsed = applyRouteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const result = await applyPlannedRoute(parsed.data);
    publishDashboardChanged();
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status !== 500) {
      res.status(status).json({ message: (err as Error).message });
      return;
    }
    console.error("POST /schedule/route/apply error:", err);
    res.status(500).json({ message: "Failed to apply route" });
  }
}

const geocodeMissingSchema = z.object({
  addressIds: z.array(z.string().min(1)).min(1).max(80),
});

async function addressIdsOnAssignedWorkOrders(
  userId: string,
  addressIds: string[],
): Promise<Set<string>> {
  if (!mongoose.Types.ObjectId.isValid(userId)) return new Set();
  const ids = addressIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (ids.length === 0) return new Set();
  const rows = await WorkOrder.find({
    ...assigneeInFilter([userId]),
    addressRef: { $in: ids },
  })
    .select("addressRef")
    .lean();
  return new Set(
    rows
      .map((row) => (row.addressRef ? String(row.addressRef) : ""))
      .filter(Boolean),
  );
}

export async function postScheduleGeocodeMissing(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const user = req.user;
    if (!user || !user.permissions.includes("jobs:read")) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }
    const parsed = geocodeMissingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "addressIds (1–80) is required" });
      return;
    }

    if (!isDispatcherRole(user)) {
      const owned = await addressIdsOnAssignedWorkOrders(
        user.id,
        parsed.data.addressIds,
      );
      const blocked = parsed.data.addressIds.some((id) => !owned.has(id));
      if (blocked) {
        res.status(403).json({ message: "Only dispatchers can geocode map pins" });
        return;
      }
    }

    const updated = await hydrateMissingAddressCoordinates(parsed.data.addressIds);
    res.json({ updated });
  } catch (err) {
    console.error("POST /schedule/geocode-missing error:", err);
    res.status(500).json({ message: "Failed to geocode addresses" });
  }
}

const MISSING_GOOGLE_KEY =
  "Google API key is not configured. Add one in Control Panel → API Services.";

export async function getCitySuggestions(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const state =
      typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : "";
    if (!isUsStateCode(state)) {
      res.status(400).json({ message: "state must be a US state code" });
      return;
    }
    if (query.length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    const apiKey = await getActiveGoogleApiKey();
    if (!apiKey) {
      res.status(503).json({ message: MISSING_GOOGLE_KEY });
      return;
    }

    const result = await suggestUsCities({ apiKey, query, state });
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.json({ suggestions: result.suggestions });
  } catch (err) {
    console.error("GET /schedule/city-suggestions error:", err);
    res.status(500).json({ message: "Failed to search cities" });
  }
}

export async function getCityDetails(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const placeId = typeof req.query.placeId === "string" ? req.query.placeId.trim() : "";
    const state =
      typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : "";
    if (!placeId) {
      res.status(400).json({ message: "placeId is required" });
      return;
    }
    if (!isUsStateCode(state)) {
      res.status(400).json({ message: "state must be a US state code" });
      return;
    }

    const apiKey = await getActiveGoogleApiKey();
    if (!apiKey) {
      res.status(503).json({ message: MISSING_GOOGLE_KEY });
      return;
    }

    const result = await resolveUsCity({ apiKey, placeId, state });
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.json({ city: result.city });
  } catch (err) {
    console.error("GET /schedule/city-details error:", err);
    res.status(500).json({ message: "Failed to look up city" });
  }
}

export async function getCityAtPoint(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const state =
      typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : "";
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ message: "lat and lng must be valid coordinates" });
      return;
    }
    if (!isUsStateCode(state)) {
      res.status(400).json({ message: "state must be a US state code" });
      return;
    }

    const apiKey = await getActiveGoogleApiKey();
    if (!apiKey) {
      res.status(503).json({ message: MISSING_GOOGLE_KEY });
      return;
    }

    const result = await resolveUsCityAt({ apiKey, lat, lng, state });
    if (!result.ok) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.json({ city: result.city });
  } catch (err) {
    console.error("GET /schedule/city-at-point error:", err);
    res.status(500).json({ message: "Failed to look up city" });
  }
}

export async function getCityBoundaries(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const state =
      typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : "";
    if (!isUsStateCode(state)) {
      res.status(400).json({ message: "state must be a US state code" });
      return;
    }
    const geojson = await cityBoundariesForState(state);
    res.json(geojson);
  } catch (err) {
    if (err instanceof CityBoundaryError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    console.error("GET /schedule/city-boundaries error:", err);
    res.status(503).json({
      message: "City boundaries are unavailable. Click the map to add a city.",
    });
  }
}

const textScheduleSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  date: z.string().regex(localDateRe, "date must be YYYY-MM-DD"),
  send: z.boolean().optional(),
});

const MISSING_TECHNICIAN_PHONE =
  "Add a mobile number for this technician before texting their schedule.";

function phoneLast4(phone: string): string | null {
  const e164 = toE164(phone);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function primaryContactsByCustomer(
  customerIds: string[],
): Promise<Map<string, { name: string; phone: string }>> {
  const ids = [
    ...new Set(customerIds.filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];
  const byCustomer = new Map<string, { name: string; phone: string }>();
  if (ids.length === 0) return byCustomer;

  const contacts = await CustomerContact.find({
    customerRef: { $in: ids },
    ...activeContactFilter,
  })
    .select("customerRef first last phone isPrimary createdAt")
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  for (const contact of contacts) {
    const key = String(contact.customerRef);
    if (byCustomer.has(key)) continue;
    const name = [contact.first, contact.last]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    byCustomer.set(key, { name, phone: (contact.phone ?? "").trim() });
  }
  return byCustomer;
}

function statusCallbackUrl(req: AuthRequest, accountSid: string): string | undefined {
  const apiBase =
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`;
  if (!isPubliclyReachableApiHost(apiBase)) return undefined;
  return `${apiBase}/webhooks/twilio/status?accountSid=${encodeURIComponent(accountSid)}`;
}

export async function postScheduleText(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user?.permissions.includes("jobs:read")) {
      res.status(403).json({ message: "Missing permission: jobs:read" });
      return;
    }

    const parsed = textScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      });
      return;
    }

    const viewed = await scheduleUserForViewer(req.user.id, parsed.data.userId);
    if (viewed.error === "invalid") {
      res.status(400).json({ message: "Invalid userId" });
      return;
    }
    if (viewed.error === "forbidden" || !viewed.person) {
      res.status(403).json({
        message: "You can only view a technician's schedule",
      });
      return;
    }

    const phoneUser = await User.findById(viewed.person._id).select("phone").lean();
    const phone = typeof phoneUser?.phone === "string" ? phoneUser.phone : "";
    const last4 = phoneLast4(phone);
    const { start, end } = localDayBounds(parsed.data.date);
    const jobs = (
      await WorkOrder.find({
        ...assigneeInFilter([viewed.person._id]),
        scheduledStart: { $gte: start, $lt: end },
      })
        .sort({ scheduledStart: 1 })
        .lean()
    ).filter((job) => {
      if (!(job.scheduledStart instanceof Date)) return false;
      return formatLocalDate(job.scheduledStart) === parsed.data.date;
    });
    const enriched = await enrichScheduleWorkOrders(jobs);
    const contacts = await primaryContactsByCustomer(
      enriched.map((job) => textField(job.customerRef)),
    );
    const appUrl = `${env.clientUrl.replace(/\/+$/, "")}/dashboard`;
    const technicianName = [viewed.person.first_name, viewed.person.last_name]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    const body = formatScheduleSms({
      date: parsed.data.date,
      technicianName,
      appUrl,
      jobs: enriched.map((job) => {
        const scheduledStart = job.scheduledStart;
        const contact = contacts.get(textField(job.customerRef));
        const rawPhone =
          contact?.phone ||
          textField(job.customerPhone) ||
          textField(job.workPhone);
        return {
          scheduledStart:
            scheduledStart instanceof Date || typeof scheduledStart === "string"
              ? scheduledStart
              : "",
          contactName: contact?.name || job.customerName,
          phone: rawPhone ? formatUsPhone(rawPhone) : "",
          street: job.address?.address ?? null,
          city: job.address?.city ?? null,
        };
      }),
    });
    const payload = {
      body,
      phoneLast4: last4,
      technicianName,
      jobCount: enriched.length,
    };

    if (!parsed.data.send) {
      res.json({ sent: false, ...payload });
      return;
    }

    if (!last4) {
      res.status(400).json({ message: MISSING_TECHNICIAN_PHONE });
      return;
    }

    const to = toE164(phone);
    if (!to) {
      res.status(400).json({ message: MISSING_TECHNICIAN_PHONE });
      return;
    }

    let account;
    let fromNumber: string;
    try {
      account = await getTwilioAccountForSend();
      fromNumber = resolveFromNumber(account);
    } catch (err) {
      const message =
        err instanceof TwilioServiceError
          ? err.message
          : "Failed to text this schedule";
      res.status(400).json({ message });
      return;
    }

    const callback = statusCallbackUrl(req, account.accountSid);
    try {
      const { sid } = await sendSms({
        account,
        from: fromNumber,
        to,
        body,
        statusCallbackUrl: callback,
      });
      try {
        await TwilioCommunication.create({
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          channel: "sms",
          direction: "outbound",
          status: "sent",
          fromNumber,
          toNumber: to,
          body,
          twilioSid: sid,
          createdByUserRef: req.user.id,
        });
      } catch (logErr) {
        console.error("POST /schedule/text log error:", logErr);
      }
      res.json({ sent: true, sid, ...payload });
    } catch (err) {
      const message =
        err instanceof TwilioServiceError
          ? err.message
          : "Failed to text this schedule";
      try {
        await TwilioCommunication.create({
          twilioAccountRef: account._id,
          accountSid: account.accountSid,
          channel: "sms",
          direction: "outbound",
          status: "failed",
          fromNumber,
          toNumber: to,
          body,
          errorMessage: message,
          createdByUserRef: req.user.id,
        });
      } catch (logErr) {
        console.error("POST /schedule/text log error:", logErr);
      }
      res.status(502).json({ message });
    }
  } catch (err) {
    console.error("POST /schedule/text error:", err);
    res.status(500).json({ message: "Failed to text this schedule" });
  }
}

import { Router, Response } from "express";
import {
  authenticate,
  requirePermission,
  AuthRequest,
} from "../middleware/auth.middleware";
import {
  getScheduleQueue,
  getScheduleStaff,
  getScheduleTechnicians,
  postScheduleSuggest,
  postSchedulePlace,
  getScheduleStartOptions,
  postScheduleGeocodeMissing,
  getScheduleRoute,
  postScheduleRoutePlan,
  postScheduleRouteApply,
} from "../controllers/schedule.controller";

const router = Router();

router.use(authenticate);

router.get("/queue", requirePermission("jobs:read"), (req, res: Response) =>
  getScheduleQueue(req as AuthRequest, res),
);

router.get("/staff", requirePermission("jobs:read"), (req, res: Response) =>
  getScheduleStaff(req as AuthRequest, res),
);

router.get("/technicians", (req, res: Response) =>
  getScheduleTechnicians(req as AuthRequest, res),
);

router.post("/suggest", requirePermission("jobs:write"), (req, res: Response) =>
  postScheduleSuggest(req as AuthRequest, res),
);

router.post("/place", requirePermission("jobs:write"), (req, res: Response) =>
  postSchedulePlace(req as AuthRequest, res),
);

router.get(
  "/start-options",
  requirePermission("jobs:read"),
  (req, res: Response) => getScheduleStartOptions(req as AuthRequest, res),
);

router.get("/route", requirePermission("jobs:read"), (req, res: Response) =>
  getScheduleRoute(req as AuthRequest, res),
);

router.post(
  "/route/plan",
  requirePermission("jobs:read"),
  (req, res: Response) => postScheduleRoutePlan(req as AuthRequest, res),
);

router.post(
  "/route/apply",
  requirePermission("jobs:write"),
  (req, res: Response) => postScheduleRouteApply(req as AuthRequest, res),
);

router.post(
  "/geocode-missing",
  requirePermission("jobs:read"),
  (req, res: Response) => postScheduleGeocodeMissing(req as AuthRequest, res),
);

export default router;

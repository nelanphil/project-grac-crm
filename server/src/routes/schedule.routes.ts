import { Router, Response } from "express";
import {
  authenticate,
  requirePermission,
  AuthRequest,
} from "../middleware/auth.middleware";
import {
  getScheduleStaff,
  postScheduleSuggest,
  getScheduleRoute,
} from "../controllers/schedule.controller";

const router = Router();

router.use(authenticate);

router.get("/staff", requirePermission("jobs:read"), (req, res: Response) =>
  getScheduleStaff(req as AuthRequest, res),
);

router.post("/suggest", requirePermission("jobs:write"), (req, res: Response) =>
  postScheduleSuggest(req as AuthRequest, res),
);

router.get("/route", requirePermission("jobs:read"), (req, res: Response) =>
  getScheduleRoute(req as AuthRequest, res),
);

export default router;

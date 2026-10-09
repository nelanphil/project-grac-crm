import { Router } from "express";
import {
  authenticate,
  authenticateIfPresent,
  requireRole,
} from "../middleware/auth.middleware";
import { crashReportRateLimit } from "../middleware/crashReportRateLimit";
import {
  createCrashReport,
  getCrashReport,
  listCrashReports,
  updateCrashReport,
} from "../controllers/crashReport.controller";

const router = Router();

router.post(
  "/",
  crashReportRateLimit,
  authenticateIfPresent,
  createCrashReport,
);

router.get(
  "/",
  authenticate,
  requireRole("super-admin"),
  listCrashReports,
);
router.get(
  "/:id",
  authenticate,
  requireRole("super-admin"),
  getCrashReport,
);
router.patch(
  "/:id",
  authenticate,
  requireRole("super-admin"),
  updateCrashReport,
);

export default router;

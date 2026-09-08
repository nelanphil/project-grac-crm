import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getWorkOrderTypes,
  createWorkOrderType,
  updateWorkOrderType,
  deleteWorkOrderType,
} from "../controllers/workOrderType.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);

router.get("/", requirePermission("jobs:read"), getWorkOrderTypes);

router.post(
  "/",
  adminRoles,
  requirePermission("jobs:write"),
  createWorkOrderType,
);
router.patch(
  "/:id",
  adminRoles,
  requirePermission("jobs:write"),
  updateWorkOrderType,
);
router.delete(
  "/:id",
  adminRoles,
  requirePermission("jobs:write"),
  deleteWorkOrderType,
);

export default router;

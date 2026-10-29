import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import { getCommunicationLog } from "../controllers/communicationLog.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("admin", "super-admin"));
router.get("/", requirePermission("messages:read"), getCommunicationLog);

export default router;

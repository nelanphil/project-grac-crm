import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  convertLead,
  createLead,
  listLeads,
  softDeleteLead,
  updateLeadStatus,
} from "../controllers/lead.controller";

const router = Router();

// Public — estimate form submission.
router.post("/", createLead);

// Authenticated staff endpoints.
router.get("/", authenticate, requirePermission("leads:read"), listLeads);
router.patch(
  "/:id/status",
  authenticate,
  requirePermission("leads:write"),
  updateLeadStatus,
);
router.post(
  "/:id/convert",
  authenticate,
  requirePermission("leads:write"),
  convertLead,
);
router.delete(
  "/:id",
  authenticate,
  requirePermission("leads:delete"),
  softDeleteLead,
);

export default router;

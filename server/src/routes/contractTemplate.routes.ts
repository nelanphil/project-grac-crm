import { Router } from "express";
import {
  authenticate,
  requireAnyPermission,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getContractTemplates,
  createContractTemplate,
  updateContractTemplate,
  duplicateContractTemplate,
  deleteContractTemplate,
} from "../controllers/contractTemplate.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin");

router.use(authenticate);

// Readable by contract viewers and by people who write estimates or work orders.
router.get(
  "/",
  requireAnyPermission("contracts:read", "jobs:write", "estimates:write"),
  getContractTemplates,
);

// Catalog mutations stay admin-only (Control Panel).
router.post("/", adminRoles, requirePermission("contracts:write"), createContractTemplate);
router.patch(
  "/:id",
  adminRoles,
  requirePermission("contracts:write"),
  updateContractTemplate,
);
router.post(
  "/:id/duplicate",
  adminRoles,
  requirePermission("contracts:write"),
  duplicateContractTemplate,
);
router.delete(
  "/:id",
  adminRoles,
  requirePermission("contracts:delete"),
  deleteContractTemplate,
);

export default router;

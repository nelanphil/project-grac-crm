import { Router } from "express";
import {
  authenticate,
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

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);

// Readable by anyone who can read contracts (for list filters / badges).
router.get("/", requirePermission("contracts:read"), getContractTemplates);

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

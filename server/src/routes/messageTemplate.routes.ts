import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getMessageTemplates,
  getMessageTemplate,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  getInvoiceMessageDefaults,
  saveInvoiceMessageDefaults,
} from "../controllers/messageTemplate.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin");

router.use(authenticate);
router.use(adminRoles);

router.get("/", requirePermission("messages:read"), getMessageTemplates);
router.get(
  "/invoice-defaults",
  requirePermission("messages:read"),
  getInvoiceMessageDefaults,
);
router.put(
  "/invoice-defaults",
  requirePermission("messages:write"),
  saveInvoiceMessageDefaults,
);
router.get("/:id", requirePermission("messages:read"), getMessageTemplate);
router.post("/", requirePermission("messages:write"), createMessageTemplate);
router.patch("/:id", requirePermission("messages:write"), updateMessageTemplate);
router.delete("/:id", requirePermission("messages:write"), deleteMessageTemplate);

export default router;

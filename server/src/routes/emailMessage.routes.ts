import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getEmailMessage,
  listEmailMessages,
  listEmailSendAccounts,
  paymentLinkAvailability,
  previewEmailMessage,
  searchEmailContacts,
  sendEmailMessages,
} from "../controllers/emailMessage.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);
router.use(adminRoles);

router.get(
  "/accounts",
  requirePermission("messages:read"),
  listEmailSendAccounts,
);
router.get("/contacts", requirePermission("messages:read"), searchEmailContacts);
router.post(
  "/payment-link-availability",
  requirePermission("messages:read"),
  paymentLinkAvailability,
);
router.post(
  "/preview",
  requirePermission("messages:read"),
  previewEmailMessage,
);
router.post("/send", requirePermission("messages:write"), sendEmailMessages);
router.get("/", requirePermission("messages:read"), listEmailMessages);
router.get("/:id", requirePermission("messages:read"), getEmailMessage);

export default router;

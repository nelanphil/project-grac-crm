import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  cancelScheduledEmailMessages,
  getEmailMessage,
  listEmailMessages,
  listEmailSendAccounts,
  listScheduledEmailMessages,
  paymentLinkAvailability,
  previewEmailMessage,
  rescheduleEmailMessages,
  scheduleEmailMessages,
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
router.post(
  "/schedule",
  requirePermission("messages:write"),
  scheduleEmailMessages,
);
router.get(
  "/scheduled",
  requirePermission("messages:read"),
  listScheduledEmailMessages,
);
router.patch(
  "/scheduled/:id",
  requirePermission("messages:write"),
  rescheduleEmailMessages,
);
router.post(
  "/scheduled/:id/cancel",
  requirePermission("messages:write"),
  cancelScheduledEmailMessages,
);
router.get("/", requirePermission("messages:read"), listEmailMessages);
router.get("/:id", requirePermission("messages:read"), getEmailMessage);

export default router;

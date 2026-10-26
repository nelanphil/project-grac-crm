import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  addInboxNote,
  callInboxConversation,
  closeInboxConversation,
  getInboxContext,
  getInboxTimeline,
  linkInboxCustomer,
  listInboxChannels,
  listInboxConversations,
  listInboxTemplates,
  markInboxRead,
  reopenInboxConversation,
  searchInboxCustomers,
  sendInboxEmail,
  sendInboxSms,
} from "../controllers/inboxes.controller";

const router = Router();

router.use(authenticate);

router.get("/channels", requirePermission("messages:read"), listInboxChannels);
router.get("/templates", requirePermission("messages:read"), listInboxTemplates);
router.get("/customers", requirePermission("messages:read"), searchInboxCustomers);
router.get("/conversations", requirePermission("messages:read"), listInboxConversations);
router.get(
  "/conversations/:id/timeline",
  requirePermission("messages:read"),
  getInboxTimeline,
);
router.get(
  "/conversations/:id/context",
  requirePermission("messages:read"),
  getInboxContext,
);
router.post(
  "/conversations/:id/read",
  requirePermission("messages:read"),
  markInboxRead,
);
router.post(
  "/conversations/:id/close",
  requirePermission("messages:write"),
  closeInboxConversation,
);
router.post(
  "/conversations/:id/reopen",
  requirePermission("messages:write"),
  reopenInboxConversation,
);
router.post(
  "/conversations/:id/sms",
  requirePermission("messages:write"),
  sendInboxSms,
);
router.post(
  "/conversations/:id/email",
  requirePermission("messages:write"),
  sendInboxEmail,
);
router.post(
  "/conversations/:id/call",
  requirePermission("messages:write"),
  callInboxConversation,
);
router.post(
  "/conversations/:id/link-customer",
  requirePermission("messages:write"),
  linkInboxCustomer,
);
router.post(
  "/conversations/:id/context",
  requirePermission("messages:write"),
  addInboxNote,
);

export default router;

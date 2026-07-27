import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getMergeFields,
  searchMessagingContacts,
  previewMessage,
  sendMessages,
  placeCall,
  listCommunications,
  listConversations,
  getConversationThread,
  getWebhookInfo,
} from "../controllers/messaging.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);
router.use(adminRoles);

router.get("/merge-fields", requirePermission("messages:read"), getMergeFields);
router.get("/contacts", requirePermission("messages:read"), searchMessagingContacts);
router.get(
  "/communications",
  requirePermission("messages:read"),
  listCommunications,
);
router.get(
  "/conversations",
  requirePermission("messages:read"),
  listConversations,
);
router.get(
  "/conversations/:contactId",
  requirePermission("messages:read"),
  getConversationThread,
);
router.get("/webhook-info", requirePermission("messages:read"), getWebhookInfo);
router.post("/preview", requirePermission("messages:read"), previewMessage);
router.post("/send", requirePermission("messages:write"), sendMessages);
router.post("/calls", requirePermission("messages:write"), placeCall);

export default router;

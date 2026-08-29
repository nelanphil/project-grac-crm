import { Router } from "express";
import {
  authenticate,
  authenticateRecordingPlayback,
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
  listThreads,
  getThreadDetail,
  checkThreadConflict,
  closeThreadEndpoint,
  getWebhookInfo,
  streamCommunicationRecording,
} from "../controllers/messaging.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.get(
  "/communications/:id/recording",
  authenticateRecordingPlayback,
  streamCommunicationRecording,
);

router.use(authenticate);
router.use(adminRoles);

router.get("/merge-fields", requirePermission("messages:read"), getMergeFields);
router.get("/contacts", requirePermission("messages:read"), searchMessagingContacts);
router.get(
  "/communications",
  requirePermission("messages:read"),
  listCommunications,
);
router.get("/threads", requirePermission("messages:read"), listThreads);
router.get(
  "/threads/check-conflict",
  requirePermission("messages:read"),
  checkThreadConflict,
);
router.get(
  "/threads/:threadId",
  requirePermission("messages:read"),
  getThreadDetail,
);
router.patch(
  "/threads/:threadId",
  requirePermission("messages:write"),
  closeThreadEndpoint,
);
router.get("/webhook-info", requirePermission("messages:read"), getWebhookInfo);
router.post("/preview", requirePermission("messages:read"), previewMessage);
router.post("/send", requirePermission("messages:write"), sendMessages);
router.post("/calls", requirePermission("messages:write"), placeCall);

export default router;

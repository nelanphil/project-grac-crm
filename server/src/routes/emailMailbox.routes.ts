import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getMailboxMessageHandler,
  getMailboxThreadHandler,
  listMailboxMessagesHandler,
  locateMailboxMessageHandler,
  markMailboxMessageSeenHandler,
  replyMailboxMessageHandler,
  setMailboxArchiveHandler,
  setMailboxAssigneesHandler,
} from "../controllers/emailMailbox.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("admin", "super-admin"));

router.get(
  "/:accountId/locate",
  requirePermission("messages:read"),
  locateMailboxMessageHandler,
);
router.get(
  "/:accountId/messages",
  requirePermission("messages:read"),
  listMailboxMessagesHandler,
);
router.get(
  "/:accountId/messages/:uid/thread",
  requirePermission("messages:read"),
  getMailboxThreadHandler,
);
router.get(
  "/:accountId/messages/:uid",
  requirePermission("messages:read"),
  getMailboxMessageHandler,
);
router.post(
  "/:accountId/messages/:uid/seen",
  requirePermission("messages:read"),
  markMailboxMessageSeenHandler,
);
router.post(
  "/:accountId/messages/:uid/reply",
  requirePermission("messages:write"),
  replyMailboxMessageHandler,
);
router.put(
  "/:accountId/messages/:uid/assignees",
  requirePermission("messages:write"),
  setMailboxAssigneesHandler,
);
router.put(
  "/:accountId/messages/:uid/archive",
  requirePermission("messages:write"),
  setMailboxArchiveHandler,
);

export default router;

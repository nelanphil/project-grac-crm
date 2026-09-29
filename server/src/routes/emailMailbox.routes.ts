import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getMailboxMessageHandler,
  listMailboxMessagesHandler,
  replyMailboxMessageHandler,
  setMailboxAssigneesHandler,
} from "../controllers/emailMailbox.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("admin", "super-admin"));

router.get(
  "/:accountId/messages",
  requirePermission("messages:read"),
  listMailboxMessagesHandler,
);
router.get(
  "/:accountId/messages/:uid",
  requirePermission("messages:read"),
  getMailboxMessageHandler,
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

export default router;

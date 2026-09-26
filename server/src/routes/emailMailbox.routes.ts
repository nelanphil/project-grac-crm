import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getMailboxMessageHandler,
  listMailboxMessagesHandler,
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

export default router;

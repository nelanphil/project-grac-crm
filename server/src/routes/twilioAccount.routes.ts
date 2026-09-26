import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getTwilioAccounts,
  createTwilioAccount,
  previewTwilioNumbers,
  syncTwilioAccountNumbers,
  updateTwilioAccount,
  deleteTwilioAccount,
} from "../controllers/twilioAccount.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin");

router.use(authenticate);
router.use(adminRoles);

router.get("/", requirePermission("integrations:read"), getTwilioAccounts);
router.post(
  "/preview-numbers",
  requirePermission("integrations:write"),
  previewTwilioNumbers,
);
router.post("/", requirePermission("integrations:write"), createTwilioAccount);
router.post(
  "/:id/sync-numbers",
  requirePermission("integrations:write"),
  syncTwilioAccountNumbers,
);
router.patch("/:id", requirePermission("integrations:write"), updateTwilioAccount);
router.delete("/:id", requirePermission("integrations:delete"), deleteTwilioAccount);

export default router;

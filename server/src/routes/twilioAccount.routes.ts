import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getTwilioAccounts,
  createTwilioAccount,
  updateTwilioAccount,
  deleteTwilioAccount,
} from "../controllers/twilioAccount.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);
router.use(adminRoles);

router.get("/", requirePermission("integrations:read"), getTwilioAccounts);
router.post("/", requirePermission("integrations:write"), createTwilioAccount);
router.patch("/:id", requirePermission("integrations:write"), updateTwilioAccount);
router.delete("/:id", requirePermission("integrations:delete"), deleteTwilioAccount);

export default router;

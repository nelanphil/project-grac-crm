import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getEmailAccounts,
  createEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  testEmailAccount,
} from "../controllers/emailAccount.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);
router.use(adminRoles);

router.get("/", requirePermission("integrations:read"), getEmailAccounts);
router.post("/", requirePermission("integrations:write"), createEmailAccount);
router.post(
  "/:id/test",
  requirePermission("integrations:write"),
  testEmailAccount
);
router.patch(
  "/:id",
  requirePermission("integrations:write"),
  updateEmailAccount
);
router.delete(
  "/:id",
  requirePermission("integrations:delete"),
  deleteEmailAccount
);

export default router;

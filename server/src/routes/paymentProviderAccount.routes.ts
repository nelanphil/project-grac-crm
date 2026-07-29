import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  createPaymentProviderAccount,
  deletePaymentProviderAccount,
  getPaymentProviderAccounts,
  getPaymentProviderWebhookInfo,
  updatePaymentProviderAccount,
} from "../controllers/paymentProviderAccount.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);
router.use(adminRoles);

router.get(
  "/webhook-info",
  requirePermission("integrations:read"),
  getPaymentProviderWebhookInfo,
);
router.get("/", requirePermission("integrations:read"), getPaymentProviderAccounts);
router.post(
  "/",
  requirePermission("integrations:write"),
  createPaymentProviderAccount,
);
router.patch(
  "/:id",
  requirePermission("integrations:write"),
  updatePaymentProviderAccount,
);
router.delete(
  "/:id",
  requirePermission("integrations:delete"),
  deletePaymentProviderAccount,
);

export default router;

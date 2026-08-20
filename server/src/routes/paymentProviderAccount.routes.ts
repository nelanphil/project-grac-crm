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
  saveSquareOAuthApp,
  squareOAuthCallback,
  startSquareOAuth,
  updatePaymentProviderAccount,
} from "../controllers/paymentProviderAccount.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

// Public Square OAuth redirect (state is signed/verified server-side).
router.get("/square/oauth/callback", squareOAuthCallback);

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
router.post(
  "/square/oauth/start",
  requirePermission("integrations:write"),
  startSquareOAuth,
);
router.put(
  "/square/oauth/app",
  requireRole("super-admin"),
  requirePermission("integrations:write"),
  saveSquareOAuthApp,
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

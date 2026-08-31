import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  deleteRecaptchaCredentials,
  getRecaptchaCredentials,
  getRecaptchaSiteKey,
  saveRecaptchaCredentials,
} from "../controllers/recaptchaCredentials.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.get("/site-key", getRecaptchaSiteKey);

router.use(authenticate);
router.use(adminRoles);

router.get("/", requirePermission("integrations:read"), getRecaptchaCredentials);
router.put(
  "/",
  requirePermission("integrations:write"),
  saveRecaptchaCredentials,
);
router.delete(
  "/",
  requirePermission("integrations:delete"),
  deleteRecaptchaCredentials,
);

export default router;

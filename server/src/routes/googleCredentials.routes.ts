import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getGoogleCredentials,
  saveGoogleCredentials,
  deleteGoogleCredentials,
} from "../controllers/googleCredentials.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);
router.use(adminRoles);

router.get("/", requirePermission("integrations:read"), getGoogleCredentials);
router.put("/", requirePermission("integrations:write"), saveGoogleCredentials);
router.delete("/", requirePermission("integrations:delete"), deleteGoogleCredentials);

export default router;

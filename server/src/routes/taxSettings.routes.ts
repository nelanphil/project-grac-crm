import { Router } from "express";
import {
  authenticate,
  requireRole,
} from "../middleware/auth.middleware";
import {
  getTaxSettings,
  saveTaxSettings,
} from "../controllers/taxSettings.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);

router.get("/", getTaxSettings);
router.put("/", adminRoles, saveTaxSettings);

export default router;

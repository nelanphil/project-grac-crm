import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getServiceAreas,
  saveServiceAreas,
} from "../controllers/serviceArea.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.get("/", getServiceAreas);
router.put("/", authenticate, adminRoles, saveServiceAreas);

export default router;

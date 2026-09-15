import { Router } from "express";
import {
  authenticate,
  requireAnyPermission,
} from "../middleware/auth.middleware";
import {
  getManufacturers,
  createManufacturer,
} from "../controllers/manufacturer.controller";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requireAnyPermission("products:read", "estimates:read", "jobs:read"),
  getManufacturers,
);
router.post(
  "/",
  requireAnyPermission("products:write", "estimates:write", "jobs:write"),
  createManufacturer,
);

export default router;

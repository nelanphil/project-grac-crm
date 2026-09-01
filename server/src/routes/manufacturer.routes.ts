import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middleware/auth.middleware";
import {
  getManufacturers,
  createManufacturer,
} from "../controllers/manufacturer.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("products:read"), getManufacturers);
router.post("/", requirePermission("products:write"), createManufacturer);

export default router;

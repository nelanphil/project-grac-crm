import { Router } from "express";
import {
  listAllCustomerActivity,
  streamAllCustomerActivity,
} from "../controllers/customerActivity.controller";
import { authenticate, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);
router.use(requireRole("admin", "super-admin"));

router.get("/live", streamAllCustomerActivity);
router.get("/", listAllCustomerActivity);

export default router;

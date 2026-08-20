import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getPaymentPlatformApps,
  savePaymentPlatformApp,
} from "../controllers/paymentPlatformApp.controller";

const router = Router();

router.use(authenticate);
router.use(requireRole("super-admin"));

router.get("/", getPaymentPlatformApps);
router.put("/:provider", savePaymentPlatformApp);

export default router;

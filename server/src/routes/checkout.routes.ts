import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  confirmCheckout,
  getCheckoutByKey,
  getCheckoutKeyByPayCode,
  getMyCheckout,
  previewCheckoutByKey,
  previewMyCheckoutDiscount,
  redirectCheckoutByPayCode,
  startCheckoutByKey,
  startMyCheckoutSession,
} from "../controllers/checkout.controller";

const router = Router();

router.get("/me", authenticate, getMyCheckout);
router.post("/me/discount", authenticate, previewMyCheckoutDiscount);
router.post("/me/session", authenticate, startMyCheckoutSession);
router.post("/confirm", confirmCheckout);
router.get("/code/:code/redirect", redirectCheckoutByPayCode);
router.get("/code/:code", getCheckoutKeyByPayCode);
router.get("/:key", getCheckoutByKey);
router.post("/:key/discount", previewCheckoutByKey);
router.post("/:key/session", startCheckoutByKey);

export default router;

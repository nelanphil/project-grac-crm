import { Router } from "express";
import { emailPreferenceRateLimit } from "../middleware/emailPreferenceRateLimit";
import {
  getPublicEmailPreferences,
  oneClickUnsubscribe,
  updatePublicEmailPreferences,
} from "../controllers/emailPreference.controller";

const router = Router();

router.use(emailPreferenceRateLimit);
router.get("/", getPublicEmailPreferences);
router.patch("/", updatePublicEmailPreferences);
router.post("/one-click", oneClickUnsubscribe);

export default router;

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getTwilioResponseSettings,
  saveTwilioResponseSettings,
} from "../controllers/twilioResponse.controller";

const twilioResponseSettingsRouter = Router();
twilioResponseSettingsRouter.use(authenticate);
twilioResponseSettingsRouter.use(requireRole("super-admin"));
twilioResponseSettingsRouter.get("/", getTwilioResponseSettings);
twilioResponseSettingsRouter.put("/", saveTwilioResponseSettings);

export default twilioResponseSettingsRouter;

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getAutomatedMessageSettings,
  saveAutomatedMessageSettings,
} from "../controllers/automatedMessage.controller";

const automatedMessageSettingsRouter = Router();
automatedMessageSettingsRouter.use(authenticate);
automatedMessageSettingsRouter.use(requireRole("super-admin"));
automatedMessageSettingsRouter.get("/", getAutomatedMessageSettings);
automatedMessageSettingsRouter.put("/", saveAutomatedMessageSettings);

export default automatedMessageSettingsRouter;

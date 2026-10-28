import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getAutomatedMessageSettings,
  saveAutomatedMessageSettings,
  testAutomatedMessageSettings,
} from "../controllers/automatedMessage.controller";

const automatedMessageSettingsRouter = Router();
automatedMessageSettingsRouter.use(authenticate);
automatedMessageSettingsRouter.use(requireRole("super-admin"));
automatedMessageSettingsRouter.get("/", getAutomatedMessageSettings);
automatedMessageSettingsRouter.put("/", saveAutomatedMessageSettings);
automatedMessageSettingsRouter.post("/test", testAutomatedMessageSettings);

export default automatedMessageSettingsRouter;

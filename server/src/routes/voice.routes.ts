import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import {
  deleteVoicePresence,
  getVoiceToken,
  getVoiceTokens,
  postVoicePresence,
  startVoiceCall,
} from "../controllers/voice.controller";

const router = Router();

router.use(authenticate);
router.get("/token", requirePermission("messages:write"), getVoiceToken);
router.get("/tokens", requirePermission("messages:write"), getVoiceTokens);
router.post("/presence", requirePermission("messages:write"), postVoicePresence);
router.delete("/presence", requirePermission("messages:write"), deleteVoicePresence);
router.post("/calls", requirePermission("messages:write"), startVoiceCall);

export default router;

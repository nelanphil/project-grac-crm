import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.middleware";
import { getVoiceToken, startVoiceCall } from "../controllers/voice.controller";

const router = Router();

router.use(authenticate);
router.get("/token", requirePermission("messages:write"), getVoiceToken);
router.post("/calls", requirePermission("messages:write"), startVoiceCall);

export default router;

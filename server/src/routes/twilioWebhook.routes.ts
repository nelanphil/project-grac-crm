import { Router } from "express";
import {
  inboundMessageWebhook,
  inboundVoiceRecordingWebhook,
  inboundVoiceWebhook,
  statusWebhook,
} from "../controllers/twilioWebhook.controller";

const router = Router();

router.post("/message", inboundMessageWebhook);
router.post("/status", statusWebhook);
router.post("/voice", inboundVoiceWebhook);
router.post("/voice/recording", inboundVoiceRecordingWebhook);

export default router;

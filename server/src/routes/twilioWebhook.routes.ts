import { Router } from "express";
import {
  inboundMessageWebhook,
  inboundVoiceGatherWebhook,
  inboundVoiceRecordingWebhook,
  inboundVoiceWebhook,
  statusWebhook,
} from "../controllers/twilioWebhook.controller";

const router = Router();

router.post("/message", inboundMessageWebhook);
router.post("/status", statusWebhook);
router.post("/voice/gather", inboundVoiceGatherWebhook);
router.post("/voice/recording", inboundVoiceRecordingWebhook);
router.post("/voice", inboundVoiceWebhook);

export default router;

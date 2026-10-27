import { Router } from "express";
import express from "express";
import {
  inboundMessageWebhook,
  inboundVoiceAnsweredWebhook,
  inboundVoiceCompleteWebhook,
  inboundVoiceGatherWebhook,
  inboundVoiceRecordingWebhook,
  inboundVoiceWebhook,
  clientVoiceWebhook,
  clientVoiceCompleteWebhook,
  clientVoiceRecordingWebhook,
  intelligenceWebhook,
  statusWebhook,
} from "../controllers/twilioWebhook.controller";

const router = Router();

router.post("/message", inboundMessageWebhook);
router.post("/status", statusWebhook);
router.post("/voice/inbound/answered", inboundVoiceAnsweredWebhook);
router.post("/voice/inbound/complete", inboundVoiceCompleteWebhook);
router.post("/voice/gather", inboundVoiceGatherWebhook);
router.post("/voice/recording", inboundVoiceRecordingWebhook);
router.post("/voice/client/complete", clientVoiceCompleteWebhook);
router.post("/voice/client/recording", clientVoiceRecordingWebhook);
router.post(
  "/intelligence",
  express.json({
    type: ["application/json", "application/*+json"],
    verify(req, _res, buf) {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
  intelligenceWebhook,
);
router.post("/voice/client", clientVoiceWebhook);
router.post("/voice", inboundVoiceWebhook);

export default router;

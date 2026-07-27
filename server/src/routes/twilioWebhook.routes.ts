import { Router } from "express";
import {
  inboundMessageWebhook,
  statusWebhook,
} from "../controllers/twilioWebhook.controller";

const router = Router();

router.post("/message", inboundMessageWebhook);
router.post("/status", statusWebhook);

export default router;

import { Router } from "express";
import { contactRateLimit } from "../middleware/contactRateLimit";
import { submitSmsOptIn } from "../controllers/smsOptIn.controller";

const router = Router();
router.post("/", contactRateLimit, submitSmsOptIn);

export default router;

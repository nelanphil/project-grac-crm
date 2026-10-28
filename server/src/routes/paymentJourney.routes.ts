import { Router } from "express";
import { paymentJourneyRateLimit } from "../middleware/paymentJourneyRateLimit";
import { postJourneyEvents, postJourneySnapshot } from "../controllers/paymentJourney.controller";

const router = Router();

router.post("/events", paymentJourneyRateLimit, postJourneyEvents);
router.post("/snapshots", paymentJourneyRateLimit, postJourneySnapshot);

export default router;

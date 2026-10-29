import { NextFunction, Request, Response, Router } from "express";
import {
  getPublicRenewalSchedule,
  postPublicRenewalSchedule,
} from "../controllers/renewalSchedulePublic.controller";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 30;
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  let bucket = buckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    res.status(429).json({ message: "Too many scheduling requests. Try again later." });
    return;
  }
  next();
}

const router = Router();
router.use(rateLimit);
router.get("/:token", getPublicRenewalSchedule);
router.post("/:token", postPublicRenewalSchedule);

export default router;

import { Request, Response, NextFunction } from "express";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 200;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function prune(now: number) {
  if (buckets.size < 500) return;
  for (const [ip, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(ip);
  }
}

/** Limits public payment-page step batches to 200 per 10 minutes per IP. */
export function paymentJourneyRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const now = Date.now();
  prune(now);

  const ip = clientIp(req);
  let bucket = buckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ message: "Too many requests." });
    return;
  }

  next();
}

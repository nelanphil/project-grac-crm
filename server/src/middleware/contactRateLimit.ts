import { Request, Response, NextFunction } from "express";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 5;

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

/** Limits public contact-form posts to 5 per hour per IP. */
export function contactRateLimit(
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
  const remaining = Math.max(0, MAX_REQUESTS - bucket.count);
  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  res.setHeader("X-RateLimit-Limit", String(MAX_REQUESTS));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > MAX_REQUESTS) {
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      message: "Too many messages. Please try again later.",
    });
    return;
  }

  next();
}

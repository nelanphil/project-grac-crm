import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Runs before the large JSON parser so unauthenticated bodies are never read. */
export function requireSourceMapToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== "POST") {
    next();
    return;
  }
  const expected = env.sourceMapUploadToken;
  if (!expected) {
    res.status(404).json({ message: "Source map uploads are not enabled." });
    return;
  }
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !sameSecret(token, expected)) {
    res.status(401).json({ message: "Invalid source map upload token." });
    return;
  }
  next();
}

import { createHash, randomBytes } from "crypto";
import { env } from "../config/env";

export function hashPayToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintPayToken(): {
  token: string;
  hash: string;
  expiresAt: Date;
} {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return { token, hash: hashPayToken(token), expiresAt };
}

export function buildPayUrl(token: string): string {
  return `${env.clientUrl.replace(/\/$/, "")}/pay/?token=${encodeURIComponent(token)}`;
}

export function samplePayUrl(): string {
  return buildPayUrl("sample-preview");
}

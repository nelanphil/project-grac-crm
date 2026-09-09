import crypto from "crypto";
import { env } from "../config/env";
import { normalizeAccountEmail } from "./provisionCustomerAccount";

export const EMAIL_PREF_CHANNELS = ["general", "billing"] as const;
export type EmailPrefChannel = (typeof EMAIL_PREF_CHANNELS)[number];

interface UnsubscribePayload {
  e: string;
  c: EmailPrefChannel;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    const dummy = Buffer.alloc(aBuf.length);
    crypto.timingSafeEqual(aBuf, dummy);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signPayload(payload: string): string {
  return crypto
    .createHmac("sha256", env.jwt.secret)
    .update(payload)
    .digest("base64url");
}

export function mintUnsubscribeToken(
  email: string,
  channel: EmailPrefChannel = "general",
): string {
  const payload = Buffer.from(
    JSON.stringify({
      e: normalizeAccountEmail(email),
      c: channel,
    } satisfies UnsubscribePayload),
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { email: string; channel: EmailPrefChannel } | null {
  const trimmed = (token ?? "").trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;

  const payload = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!timingSafeEqualString(sig, signPayload(payload))) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<UnsubscribePayload>;
    const email = normalizeAccountEmail(String(parsed.e ?? ""));
    if (!email || !email.includes("@")) return null;
    const channel: EmailPrefChannel =
      parsed.c === "billing" ? "billing" : "general";
    return { email, channel };
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(
  email: string,
  channel: EmailPrefChannel = "general",
): string {
  const token = mintUnsubscribeToken(email, channel);
  const base = env.clientUrl.replace(/\/$/, "");
  return `${base}/unsubscribe/?token=${encodeURIComponent(token)}`;
}

export function buildUnsubscribeOneClickUrl(
  email: string,
  channel: EmailPrefChannel = "general",
): string {
  const token = mintUnsubscribeToken(email, channel);
  const base = env.publicApiUrl.replace(/\/$/, "");
  return `${base}/email-preferences/one-click?token=${encodeURIComponent(token)}`;
}

const UNSUBSCRIBE_MAILTO = "info@generatormaintenancefl.com";

export function listUnsubscribeHeaders(
  email: string,
  channel: EmailPrefChannel = "general",
): Record<string, string> {
  const oneClickUrl = buildUnsubscribeOneClickUrl(email, channel);
  const pageUrl = buildUnsubscribeUrl(email, channel);
  return {
    "List-Unsubscribe": `<${oneClickUrl}>, <${pageUrl}>, <mailto:${UNSUBSCRIBE_MAILTO}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

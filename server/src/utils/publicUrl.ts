import { Request } from "express";
import { env } from "../config/env";

/**
 * Resolve the externally-reachable API base URL.
 * Prefer PUBLIC_API_URL; otherwise derive from the incoming request
 * (including X-Forwarded-* behind Render/proxies). Never advertise
 * localhost in production.
 */
export function resolvePublicApiBase(req?: Request): string {
  const configured = process.env.PUBLIC_API_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  if (req) {
    const protoHeader = req.headers["x-forwarded-proto"];
    const proto = (
      (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ||
      req.protocol ||
      "https"
    )
      .split(",")[0]
      .trim();
    const hostHeader = req.headers["x-forwarded-host"];
    const host = (
      (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ||
      req.get("host") ||
      ""
    )
      .split(",")[0]
      .trim();
    if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
      return `${proto}://${host}`;
    }
    if (host && process.env.NODE_ENV !== "production") {
      return `${proto}://${host}`;
    }
  }

  const fallback = env.publicApiUrl.replace(/\/+$/, "");
  if (
    process.env.NODE_ENV === "production" &&
    /localhost|127\.0\.0\.1/i.test(fallback)
  ) {
    console.warn(
      "[publicUrl] PUBLIC_API_URL is not set; OAuth/webhook URLs cannot use localhost in production. Set PUBLIC_API_URL to your deployed API origin.",
    );
  }
  return fallback;
}

/**
 * True when `urlOrHost` is a hostname Twilio can reach (not localhost,
 * loopback, `.local`, or a bare hostname without a dot).
 */
export function isPubliclyReachableApiHost(urlOrHost: string): boolean {
  let host: string;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    host = urlOrHost;
  }
  if (!host) return false;
  return !(
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    !host.includes(".")
  );
}

/** Frontend base used for post-OAuth redirects. */
export function resolveClientBaseUrl(): string {
  const raw = env.clientUrl.split(",")[0]?.trim().replace(/\/+$/, "") || "";
  if (raw && raw !== "[REDACTED]") return raw;
  return "";
}

import { createHash } from "node:crypto";
import type { Request } from "express";
import { getMongoStatus } from "../config/mongodb";
import { CrashReport } from "../models/mongo/CrashReport";

const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_IDS = 50;
const MAX_BODY_KEYS = 30;

type CaptureRequest = Request & {
  requestId?: string;
  user?: { id?: string; email?: string; role?: string };
};

function clip(value: string | undefined, max: number): string {
  if (!value) return "";
  return value.length > max ? value.slice(0, max) : value;
}

/** Collapses ids, numbers, and quoted values so the same bug groups together. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{24}\b/gi, "<id>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<uuid>",
    )
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "<str>")
    .replace(/\d+/g, "<n>")
    .trim();
}

export function topStackFrame(stack: string): string {
  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    if (trimmed.includes("node_modules") || trimmed.includes("node:internal")) {
      continue;
    }
    return trimmed.replace(/:\d+:\d+\)?$/, "");
  }
  return "";
}

export function errorFingerprint(input: {
  name: string;
  message: string;
  stack?: string;
  route?: string;
}): string {
  const parts = [
    input.name,
    normalizeMessage(input.message),
    topStackFrame(input.stack ?? ""),
    input.route ?? "",
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Top-level body field names only; values are never stored. */
export function bodyKeys(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.keys(body as Record<string, unknown>)
    .slice(0, MAX_BODY_KEYS)
    .map((key) => clip(key, 60));
}

export function routePattern(req: Request): string {
  const routePath =
    req.route && typeof req.route.path === "string" ? req.route.path : "";
  if (routePath) return clip(`${req.baseUrl || ""}${routePath}`, 300);
  return clip((req.originalUrl || req.url || "").split("?")[0], 300);
}

export interface ServerErrorInput {
  err?: unknown;
  req: Request;
  status: number;
  message?: string;
}

export function describeServerError(input: ServerErrorInput) {
  const req = input.req as CaptureRequest;
  const err = input.err;
  const route = routePattern(req);
  const method = (req.method || "").toUpperCase();
  const isError = err instanceof Error;
  const name = isError ? err.name || "Error" : "ServerError";
  const message =
    clip(
      isError
        ? err.message
        : err !== undefined
          ? String(err)
          : input.message || `${input.status} ${method} ${route}`,
      2000,
    ) || `${input.status} ${method} ${route}`;
  const stack = isError ? clip(err.stack, 16000) : "";
  const causes: { name: string; message: string; stack: string }[] = [];
  let cause: unknown = isError ? (err as Error & { cause?: unknown }).cause : undefined;
  while (cause !== undefined && causes.length < 5) {
    causes.push({
      name: cause instanceof Error ? cause.name : typeof cause,
      message: clip(cause instanceof Error ? cause.message : String(cause), 2000),
      stack: cause instanceof Error ? clip(cause.stack, 8000) : "",
    });
    cause = cause instanceof Error ? (cause as Error & { cause?: unknown }).cause : undefined;
  }

  return {
    name,
    message,
    stack,
    causes,
    route,
    method,
    path: clip((req.originalUrl || req.url || "").split("?")[0], 500),
    fingerprint: errorFingerprint({ name, message, stack, route }),
    requestId: req.requestId ?? "",
    user: req.user,
  };
}

/**
 * Records a server-side failure. Repeats of the same fingerprint within 24h
 * increment `occurrences` on the open report instead of adding documents.
 * Never throws.
 */
export async function recordServerError(input: ServerErrorInput): Promise<void> {
  try {
    if (getMongoStatus() !== "connected") return;
    const info = describeServerError(input);
    const req = input.req;
    const now = new Date();

    const grouped = await CrashReport.findOneAndUpdate(
      {
        origin: "server",
        status: "open",
        fingerprint: info.fingerprint,
        lastSeenAt: { $gte: new Date(now.getTime() - GROUP_WINDOW_MS) },
      },
      {
        $inc: { occurrences: 1 },
        $set: { lastSeenAt: now, requestId: info.requestId },
        ...(info.requestId
          ? {
              $push: {
                requestIds: { $each: [info.requestId], $slice: -MAX_REQUEST_IDS },
              },
            }
          : {}),
      },
    );
    if (grouped) return;

    await CrashReport.create({
      status: "open",
      origin: "server",
      source: "server",
      name: info.name,
      message: info.message,
      stack: info.stack,
      causes: info.causes,
      url: info.path,
      pathname: info.path,
      userAgent: clip(String(req.headers?.["user-agent"] ?? ""), 500),
      occurredAt: now,
      lastSeenAt: now,
      requestId: info.requestId,
      requestIds: info.requestId ? [info.requestId] : [],
      http: {
        method: info.method,
        route: info.route,
        path: info.path,
        status: input.status,
        bodyKeys: bodyKeys(req.body),
      },
      fingerprint: info.fingerprint,
      occurrences: 1,
      release: clip(process.env.RENDER_GIT_COMMIT ?? "", 100),
      environment: {
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
      },
      userId: info.user?.id ?? null,
      userEmail: info.user?.email ?? "",
      userRole: info.user?.role ?? "",
      ip: req.ip || req.socket?.remoteAddress || "",
    });
  } catch (error) {
    console.error("Failed to record server error:", error);
  }
}

/** Records a process-level failure (unhandled rejection / uncaught exception). */
export async function recordProcessError(
  kind: "unhandledRejection" | "uncaughtException",
  err: unknown,
): Promise<void> {
  try {
    if (getMongoStatus() !== "connected") return;
    const isError = err instanceof Error;
    const name = isError ? err.name || "Error" : kind;
    const message = clip(isError ? err.message : String(err), 2000) || kind;
    const stack = isError ? clip(err.stack, 16000) : "";
    const now = new Date();
    await CrashReport.create({
      status: "open",
      origin: "server",
      source: "server",
      name,
      message,
      stack,
      occurredAt: now,
      lastSeenAt: now,
      fingerprint: errorFingerprint({ name, message, stack, route: kind }),
      context: { kind },
      release: clip(process.env.RENDER_GIT_COMMIT ?? "", 100),
      environment: {
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
      },
    });
  } catch (error) {
    console.error("Failed to record process error:", error);
  }
}

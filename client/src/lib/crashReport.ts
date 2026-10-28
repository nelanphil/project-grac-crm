import { useAuthStore } from "@/store/useAuthStore";
import {
  copyBreadcrumbs,
  pushBreadcrumb,
  redactUrl,
  type CrashBreadcrumb,
} from "@/lib/crashBreadcrumbs";

export type { CrashBreadcrumb } from "@/lib/crashBreadcrumbs";
export { recordRoute } from "@/lib/crashBreadcrumbs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009";
const BUILD_RELEASE = process.env.NEXT_PUBLIC_RELEASE ?? "";
const PENDING_KEY = "grac.pendingCrashReports";
const MAX_PENDING = 5;
const MAX_CAUSES = 5;
const MAX_ADDITIONAL = 10;

function clip(value: string | undefined, max: number): string {
  if (!value) return "";
  const trimmed = value.replace(/\u0000/g, "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export type CrashSource = "render" | "window" | "unhandledrejection" | "chunk";

export interface CrashErrorPart {
  name: string;
  message: string;
  stack: string;
}

export interface CrashAdditionalError extends CrashErrorPart {
  source: CrashSource;
  at: string;
}

export type CrashContext = Record<string, string | number | boolean>;

export interface CrashEnvironment {
  timeSinceLoadMs?: number;
  referrer?: string;
  timezone?: string;
  locale?: string;
  screen?: string;
  pixelRatio?: number;
  connection?: string;
  deviceMemory?: number;
  standalone?: boolean;
  visibility?: string;
  digest?: string;
}

export interface CrashSnapshot {
  clientReportId: string;
  release: string;
  source: CrashSource;
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  causes: CrashErrorPart[];
  context: CrashContext;
  additionalErrors: CrashAdditionalError[];
  url: string;
  pathname: string;
  userAgent: string;
  viewport: string;
  online: boolean;
  occurredAt: string;
  loggedIn: boolean;
  userEmail: string;
  userRole: string;
  environment: CrashEnvironment;
  breadcrumbs: CrashBreadcrumb[];
}

export interface CrashNarrative {
  whatWereYouDoing: string;
  whatHappened: string;
  reporterEmail?: string;
}

type CrashListener = (crash: CrashSnapshot) => void;

const listeners = new Set<CrashListener>();

let listenersInstalled = false;
let handling = false;
let current: CrashSnapshot | null = null;
let loadedVersion = "";

export function isChunkLoadMessage(message: string): boolean {
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    message,
  );
}

function isBenignMessage(message: string): boolean {
  return (
    message === "Script error." ||
    message.startsWith("ResizeObserver loop") ||
    message === "AbortError"
  );
}

function newReportId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function safeStringify(value: unknown, max: number): string {
  if (typeof value === "string") return clip(value, max);
  if (value === undefined) return "undefined";
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol" || typeof value === "bigint") return String(value);
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, inner: unknown) => {
      if (typeof inner === "bigint") return inner.toString();
      if (inner && typeof inner === "object") {
        if (seen.has(inner)) return "[circular]";
        seen.add(inner);
      }
      return inner;
    });
    return clip(json ?? String(value), max);
  } catch {
    return clip(String(value), max);
  }
}

function errorPart(value: unknown): CrashErrorPart {
  if (value instanceof Error) {
    return {
      name: clip(value.name, 200) || "Error",
      message: clip(value.message, 2000),
      stack: clip(value.stack, 8000),
    };
  }
  return {
    name: value === null ? "null" : typeof value,
    message: safeStringify(value, 2000),
    stack: "",
  };
}

const CONTEXT_KEYS = [
  "status",
  "code",
  "method",
  "endpoint",
  "requestId",
  "digest",
] as const;

/**
 * Flattens any thrown value into a primary error, its `cause` chain, and
 * scalar context fields such as ApiError status and request ID.
 */
export function serializeError(value: unknown): {
  name: string;
  message: string;
  stack: string;
  causes: CrashErrorPart[];
  context: CrashContext;
} {
  const primary = errorPart(value);
  const context: CrashContext = {};

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of CONTEXT_KEYS) {
      const field = record[key];
      if (
        typeof field === "string" ||
        typeof field === "number" ||
        typeof field === "boolean"
      ) {
        context[key] = typeof field === "string" ? clip(field, 300) : field;
      }
    }
    if (!(value instanceof Error)) {
      context.thrownType = Array.isArray(value)
        ? "array"
        : (value.constructor?.name ?? "object");
    }
  } else if (!(value instanceof Error)) {
    context.thrownType = value === null ? "null" : typeof value;
  }

  const causes: CrashErrorPart[] = [];
  let cause: unknown =
    value instanceof Error ? (value as Error & { cause?: unknown }).cause : undefined;
  const visited = new Set<unknown>([value]);
  while (cause !== undefined && causes.length < MAX_CAUSES && !visited.has(cause)) {
    visited.add(cause);
    causes.push(errorPart(cause));
    cause =
      cause instanceof Error ? (cause as Error & { cause?: unknown }).cause : undefined;
  }

  return { ...primary, causes, context };
}

function clickDetail(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  const title = el.getAttribute("title")?.trim();
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  const label = (aria || title || text).slice(0, 80);
  const tag = el.tagName.toLowerCase();
  return label ? `${tag}: ${label}` : tag;
}

function captureEnvironment(digest?: string): CrashEnvironment {
  if (typeof window === "undefined") return digest ? { digest } : {};
  const env: CrashEnvironment = {};
  try {
    env.timeSinceLoadMs = Math.round(performance.now());
    env.referrer = clip(redactUrl(document.referrer), 500) || undefined;
    env.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    env.locale = navigator.language;
    env.screen = `${window.screen.width}x${window.screen.height}`;
    env.pixelRatio = window.devicePixelRatio;
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
      deviceMemory?: number;
      standalone?: boolean;
    };
    if (nav.connection?.effectiveType) {
      env.connection = [
        nav.connection.effectiveType,
        typeof nav.connection.downlink === "number"
          ? `${nav.connection.downlink}Mbps`
          : "",
        nav.connection.saveData ? "save-data" : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (typeof nav.deviceMemory === "number") env.deviceMemory = nav.deviceMemory;
    env.standalone =
      Boolean(nav.standalone) ||
      window.matchMedia?.("(display-mode: standalone)").matches === true;
    env.visibility = document.visibilityState;
  } catch {
    // Environment details are best-effort.
  }
  if (digest) env.digest = clip(digest, 200);
  return env;
}

export interface CaptureInput {
  source: CrashSource;
  error?: unknown;
  name?: string;
  message?: string;
  stack?: string;
  componentStack?: string;
  digest?: string;
}

export function captureError(input: CaptureInput): CrashSnapshot {
  const user = useAuthStore.getState().user;
  const serialized =
    input.error !== undefined ? serializeError(input.error) : null;
  const message =
    clip(serialized?.message || input.message, 2000) || "Unknown error";
  const source = isChunkLoadMessage(message) ? "chunk" : input.source;
  const digest =
    input.digest ||
    (typeof serialized?.context.digest === "string"
      ? serialized.context.digest
      : undefined);
  return {
    clientReportId: newReportId(),
    release: BUILD_RELEASE || loadedVersion,
    source,
    name: clip(serialized?.name || input.name, 200) || "Error",
    message,
    stack: clip(serialized?.stack || input.stack, 16000),
    componentStack: clip(input.componentStack, 16000),
    causes: serialized?.causes ?? [],
    context: serialized?.context ?? {},
    additionalErrors: [],
    url: typeof location !== "undefined" ? clip(redactUrl(location.href), 2000) : "",
    pathname:
      typeof location !== "undefined" ? clip(location.pathname, 500) : "",
    userAgent:
      typeof navigator !== "undefined" ? clip(navigator.userAgent, 500) : "",
    viewport:
      typeof window !== "undefined"
        ? `${window.innerWidth}x${window.innerHeight}`
        : "",
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    occurredAt: new Date().toISOString(),
    loggedIn: Boolean(user),
    userEmail: user?.email ?? "",
    userRole: user?.role ?? "",
    environment: captureEnvironment(digest),
    breadcrumbs: copyBreadcrumbs(),
  };
}

function notify(snapshot: CrashSnapshot): void {
  listeners.forEach((listener) => listener(snapshot));
}

export function reportCrash(input: CaptureInput): void {
  const probe = input.error instanceof Error ? input.error : null;
  const rawMessage = probe?.message ?? input.message ?? "";
  const rawName = probe?.name ?? input.name;
  if (isBenignMessage(rawMessage) || rawName === "AbortError") return;

  const snapshot = captureError(input);

  if (handling && current) {
    let next = current;
    if (snapshot.componentStack && !current.componentStack) {
      next = {
        ...next,
        componentStack: snapshot.componentStack,
        source: snapshot.source === "render" ? "render" : next.source,
      };
    }
    const duplicate =
      snapshot.message === current.message && snapshot.name === current.name;
    if (!duplicate && next.additionalErrors.length < MAX_ADDITIONAL) {
      next = {
        ...next,
        additionalErrors: [
          ...next.additionalErrors,
          {
            source: snapshot.source,
            name: snapshot.name,
            message: snapshot.message,
            stack: clip(snapshot.stack, 8000),
            at: snapshot.occurredAt,
          },
        ],
      };
    }
    if (next !== current) {
      current = next;
      notify(next);
    }
    return;
  }

  handling = true;
  current = snapshot;
  notify(snapshot);
}

/** Leaves a breadcrumb for an error that was caught and handled. */
export function recordHandledError(error: unknown, label?: string): void {
  const part = errorPart(error);
  const prefix = label ? `${label}: ` : "";
  pushBreadcrumb("error", `${prefix}${part.name}: ${part.message}`);
}

export function subscribeCrashes(listener: CrashListener): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
  };
}

function onWindowError(event: ErrorEvent): void {
  const file = event.filename || "";
  if (
    file.startsWith("chrome-extension://") ||
    file.startsWith("moz-extension://") ||
    file.startsWith("safari-extension://")
  ) {
    return;
  }
  const err = event.error;
  const message =
    err instanceof Error
      ? err.message
      : typeof event.message === "string"
        ? event.message
        : "Unknown error";
  if (!message || isBenignMessage(message)) return;
  const location = file ? `${file}:${event.lineno}:${event.colno}` : "";
  reportCrash({
    source: "window",
    error: err === undefined || err === null ? undefined : err,
    name: "Error",
    message,
    stack: err instanceof Error ? err.stack : location ? `    at ${location}` : undefined,
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason: unknown = event.reason;
  if (reason instanceof Error && reason.name === "AbortError") return;
  if (reason === undefined || reason === null || reason === "") {
    reportCrash({
      source: "unhandledrejection",
      name: "UnhandledRejection",
      message: `Promise rejected with ${String(reason) || "an empty value"}`,
    });
    return;
  }
  reportCrash({
    source: "unhandledrejection",
    error: reason,
    name: reason instanceof Error ? reason.name : "UnhandledRejection",
  });
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const el = target.closest("a, button, [role='button'], [role='link']");
  if (!el) return;
  if (el.closest("[data-crash-dialog]")) return;
  pushBreadcrumb("click", clickDetail(el));
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      arg instanceof Error ? `${arg.name}: ${arg.message}` : safeStringify(arg, 300),
    )
    .join(" ");
}

function wrapConsole(level: "error" | "warn"): void {
  const original = console[level];
  if (typeof original !== "function") return;
  let inside = false;
  console[level] = (...args: unknown[]) => {
    if (!inside) {
      inside = true;
      try {
        pushBreadcrumb("console", `${level}: ${formatConsoleArgs(args)}`);
      } catch {
        // Never let breadcrumb capture break logging.
      } finally {
        inside = false;
      }
    }
    original.apply(console, args);
  };
}

async function loadReleaseVersion(): Promise<void> {
  if (BUILD_RELEASE || process.env.NODE_ENV !== "production") return;
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: unknown };
    if (typeof data.version === "string") loadedVersion = clip(data.version, 100);
  } catch {
    // Release is optional.
  }
}

export function installCrashCapture(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  document.addEventListener("click", onDocumentClick, true);
  window.addEventListener("online", () => pushBreadcrumb("lifecycle", "online"));
  window.addEventListener("offline", () => pushBreadcrumb("lifecycle", "offline"));
  document.addEventListener("visibilitychange", () =>
    pushBreadcrumb("lifecycle", `tab ${document.visibilityState}`),
  );
  wrapConsole("error");
  wrapConsole("warn");
  void loadReleaseVersion();
  window.setTimeout(() => void flushPendingCrashReports(), 3000);
}

type CrashPayload = Record<string, unknown> & { clientReportId: string };

function buildPayload(
  crash: CrashSnapshot,
  narrative: CrashNarrative | null,
): CrashPayload {
  return {
    clientReportId: crash.clientReportId,
    release: crash.release || undefined,
    source: crash.source,
    name: crash.name,
    message: crash.message,
    stack: crash.stack || undefined,
    componentStack: crash.componentStack || undefined,
    causes: crash.causes,
    context: crash.context,
    additionalErrors: crash.additionalErrors,
    url: crash.url || undefined,
    pathname: crash.pathname || undefined,
    userAgent: crash.userAgent || undefined,
    viewport: crash.viewport || undefined,
    online: crash.online,
    occurredAt: crash.occurredAt,
    environment: crash.environment,
    whatWereYouDoing: narrative?.whatWereYouDoing.trim() || undefined,
    whatHappened: narrative?.whatHappened.trim() || undefined,
    reporterEmail: crash.loggedIn
      ? undefined
      : narrative?.reporterEmail?.trim() || undefined,
    breadcrumbs: crash.breadcrumbs,
  };
}

function readPending(): CrashPayload[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed.filter(
          (item) => item && typeof item === "object" && "clientReportId" in item,
        ) as CrashPayload[])
      : [];
  } catch {
    return [];
  }
}

function writePending(items: CrashPayload[]): void {
  try {
    if (items.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(items.slice(-MAX_PENDING)));
  } catch {
    // Storage may be full or unavailable.
  }
}

function enqueuePending(payload: CrashPayload): void {
  const items = readPending().filter(
    (item) => item.clientReportId !== payload.clientReportId,
  );
  items.push(payload);
  writePending(items);
}

function removePending(clientReportId: string): void {
  writePending(
    readPending().filter((item) => item.clientReportId !== clientReportId),
  );
}

async function postPayload(
  payload: CrashPayload,
  token: string | null,
  options?: { keepalive?: boolean },
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = JSON.stringify(payload);
  return fetch(`${API_URL}/crash-reports`, {
    method: "POST",
    headers,
    body,
    // keepalive bodies are capped at 64KB by browsers.
    keepalive: Boolean(options?.keepalive) && body.length < 60000,
  });
}

function isRetryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export async function submitCrashReport(
  crash: CrashSnapshot,
  narrative: CrashNarrative | null,
  token: string | null,
  options?: { keepalive?: boolean },
): Promise<void> {
  const payload = buildPayload(crash, narrative);

  let res: Response;
  try {
    res = await postPayload(payload, token, options);
  } catch {
    enqueuePending(payload);
    throw new Error(
      "Could not reach the server. The report was saved and will be sent next time the app loads.",
    );
  }

  if (!res.ok) {
    if (isRetryable(res.status)) enqueuePending(payload);
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || "Could not send the report.");
  }
  removePending(payload.clientReportId);
}

export async function flushPendingCrashReports(): Promise<void> {
  const items = readPending();
  if (items.length === 0) return;
  const token = useAuthStore.getState().token;
  for (const item of items) {
    try {
      const res = await postPayload(item, token);
      if (res.ok || !isRetryable(res.status)) removePending(item.clientReportId);
    } catch {
      return;
    }
  }
}

/** Sends the technical report (no narrative) and reloads, waiting at most ~2.5s. */
export async function sendAndReload(
  crash: CrashSnapshot,
  token: string | null,
): Promise<void> {
  enqueuePending(buildPayload(crash, null));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
  const send = submitCrashReport(crash, null, token, { keepalive: true }).catch(
    () => undefined,
  );
  await Promise.race([send, timeout]);
  reloadApp();
}

export function reloadApp(): void {
  window.location.reload();
}

if (typeof window !== "undefined") {
  installCrashCapture();
}

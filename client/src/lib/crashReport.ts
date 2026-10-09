import { useAuthStore } from "@/store/useAuthStore";
import {
  copyBreadcrumbs,
  pushBreadcrumb,
  type CrashBreadcrumb,
} from "@/lib/crashBreadcrumbs";

export type { CrashBreadcrumb } from "@/lib/crashBreadcrumbs";
export { recordRoute } from "@/lib/crashBreadcrumbs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009";

function clip(value: string | undefined, max: number): string {
  if (!value) return "";
  const trimmed = value.replace(/\u0000/g, "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export type CrashSource = "render" | "window" | "unhandledrejection" | "chunk";

export interface CrashSnapshot {
  source: CrashSource;
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  url: string;
  pathname: string;
  userAgent: string;
  viewport: string;
  online: boolean;
  occurredAt: string;
  loggedIn: boolean;
  userEmail: string;
  userRole: string;
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

function clickDetail(el: Element): string {
  const aria = el.getAttribute("aria-label")?.trim();
  const title = el.getAttribute("title")?.trim();
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  const label = (aria || title || text).slice(0, 80);
  const tag = el.tagName.toLowerCase();
  return label ? `${tag}: ${label}` : tag;
}

export function captureError(input: {
  source: CrashSource;
  name?: string;
  message: string;
  stack?: string;
  componentStack?: string;
}): CrashSnapshot {
  const user = useAuthStore.getState().user;
  const message = clip(input.message, 2000) || "Unknown error";
  const source = isChunkLoadMessage(message) ? "chunk" : input.source;
  return {
    source,
    name: clip(input.name, 200) || "Error",
    message,
    stack: clip(input.stack, 16000),
    componentStack: clip(input.componentStack, 16000),
    url: typeof location !== "undefined" ? clip(location.href, 2000) : "",
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
    breadcrumbs: copyBreadcrumbs(),
  };
}

export function reportCrash(input: {
  source: CrashSource;
  name?: string;
  message: string;
  stack?: string;
  componentStack?: string;
}): void {
  if (isBenignMessage(input.message) || input.name === "AbortError") return;

  const snapshot = captureError(input);

  if (handling && current) {
    if (snapshot.componentStack && !current.componentStack) {
      current = {
        ...current,
        componentStack: snapshot.componentStack,
        source: snapshot.source === "render" ? "render" : current.source,
      };
      listeners.forEach((listener) => listener(current as CrashSnapshot));
    }
    return;
  }

  handling = true;
  current = snapshot;
  listeners.forEach((listener) => listener(snapshot));
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
  reportCrash({
    source: "window",
    name: err instanceof Error ? err.name : "Error",
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  if (reason instanceof Error && reason.name === "AbortError") return;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Unhandled rejection";
  if (!message || isBenignMessage(message)) return;
  reportCrash({
    source: "unhandledrejection",
    name: reason instanceof Error ? reason.name : "UnhandledRejection",
    message,
    stack: reason instanceof Error ? reason.stack : undefined,
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

export function installCrashCapture(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  document.addEventListener("click", onDocumentClick, true);
}

export async function submitCrashReport(
  crash: CrashSnapshot,
  narrative: CrashNarrative,
  token: string | null,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body = {
    source: crash.source,
    name: crash.name,
    message: crash.message,
    stack: crash.stack || undefined,
    componentStack: crash.componentStack || undefined,
    url: crash.url || undefined,
    pathname: crash.pathname || undefined,
    userAgent: crash.userAgent || undefined,
    viewport: crash.viewport || undefined,
    online: crash.online,
    occurredAt: crash.occurredAt,
    whatWereYouDoing: narrative.whatWereYouDoing.trim(),
    whatHappened: narrative.whatHappened.trim(),
    reporterEmail: crash.loggedIn
      ? undefined
      : narrative.reporterEmail?.trim() || undefined,
    breadcrumbs: crash.breadcrumbs,
  };

  let res: Response;
  try {
    res = await fetch(`${API_URL}/crash-reports`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Could not reach the server. You can reload without sending.",
    );
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message || "Could not send the report.");
  }
}

export function reloadApp(): void {
  window.location.reload();
}

if (typeof window !== "undefined") {
  installCrashCapture();
}

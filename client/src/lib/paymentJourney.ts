import { onBreadcrumb, type CrashBreadcrumb } from "@/lib/crashBreadcrumbs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009";
const STORAGE_KEY = "grac.paymentJourney";
/** A tab left alone this long starts a fresh visit. */
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5000;
const BATCH_LIMIT = 50;
const QUEUE_LIMIT = 300;
const DETAIL_MAX = 500;

export type JourneyEntry = "checkout" | "pay" | "invoice_view" | "complete";

export type JourneyLink = {
  checkoutKey?: string;
  payCode?: string;
  payToken?: string;
  viewToken?: string;
  invoiceId?: string;
};

type JourneyEventType = "step" | "route" | "click" | "api" | "console" | "error" | "lifecycle";

type JourneyEvent = {
  t: number;
  type: JourneyEventType;
  detail: string;
  meta?: { status?: number; durationMs?: number; message?: string };
};

type StoredSession = { id: string; lastAt: number; link: JourneyLink; snapshots?: number };

const SNAPSHOT_LIMIT = 4;
const SNAPSHOT_MAX_WIDTH = 900;
const SNAPSHOT_MAX_BYTES = 300 * 1024;
const PRIVATE_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "hidden"]);

let entry: JourneyEntry | null = null;
let link: JourneyLink = {};
let sessionId = "";
let snapshotCount = 0;
const queue: JourneyEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let teardown: Array<() => void> = [];

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.id || Date.now() - parsed.lastAt > SESSION_IDLE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(): void {
  try {
    const stored: StoredSession = {
      id: sessionId,
      lastAt: Date.now(),
      link,
      snapshots: snapshotCount,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode can block storage; the visit just won't span pages.
  }
}

function cleanLink(value: JourneyLink): JourneyLink {
  const next: JourneyLink = {};
  for (const key of Object.keys(value) as Array<keyof JourneyLink>) {
    const item = value[key]?.trim();
    if (item) next[key] = item;
  }
  return next;
}

function sameLink(a: JourneyLink, b: JourneyLink): boolean {
  return (Object.keys(b) as Array<keyof JourneyLink>).every(
    (key) => !a[key] || a[key] === b[key],
  );
}

const NAMED_SEGMENTS = new Set(["me", "confirm", "code", "session", "discount", "checkout"]);

/** Hides payment-link tokens that appear in API paths. */
export function scrubJourneyDetail(detail: string): string {
  return detail
    .replace(/\/checkout\/code\/[^/\s?]+/g, "/checkout/code/[link]")
    .replace(
      /\/(checkout|pay|invoice-view)\/([^/\s?]+)/g,
      (match, base: string, segment: string) =>
        NAMED_SEGMENTS.has(segment) || segment === "[link]" ? match : `/${base}/[link]`,
    )
    .slice(0, DETAIL_MAX);
}

function enqueue(event: JourneyEvent): void {
  if (!entry) return;
  queue.push({ ...event, detail: scrubJourneyDetail(event.detail) });
  if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT);
  writeSession();
}

function fromBreadcrumb(item: CrashBreadcrumb): void {
  if (item.type === "api" && item.detail.includes("/payment-journeys")) return;
  enqueue({
    t: item.t,
    type: item.type,
    detail: item.detail,
    ...(item.meta
      ? {
          meta: {
            status: item.meta.status,
            durationMs: item.meta.durationMs,
            message: item.meta.message,
          },
        }
      : {}),
  });
}

function send(batch: JourneyEvent[], beacon: boolean): void {
  if (!entry || batch.length === 0) return;
  const body = JSON.stringify({ sessionId, entry, link, events: batch });
  const url = `${API_URL}/payment-journeys/events`;
  try {
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      if (ok) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      credentials: "omit",
      keepalive: body.length < 60000,
    }).catch(() => {
      // Losing a batch is fine; it must never surface to the customer.
    });
  } catch {
    // Same as above.
  }
}

export function flushPaymentJourney(beacon = false): void {
  while (queue.length > 0) {
    send(queue.splice(0, BATCH_LIMIT), beacon);
  }
}

function onPageHide(): void {
  enqueue({ t: Date.now(), type: "lifecycle", detail: "page closed or navigated away" });
  flushPaymentJourney(true);
}

function onVisibility(): void {
  if (document.visibilityState === "hidden") flushPaymentJourney(true);
}

function onWindowError(event: ErrorEvent): void {
  const message = event.error instanceof Error ? event.error.message : event.message;
  if (!message || message === "Script error.") return;
  enqueue({ t: Date.now(), type: "error", detail: `script error: ${message}`, meta: { message } });
}

function onRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  if (reason instanceof Error && reason.name === "AbortError") return;
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (!message) return;
  enqueue({ t: Date.now(), type: "error", detail: `unhandled: ${message}`, meta: { message } });
}

/**
 * Starts recording the customer's steps on a public payment page. Returns a stop
 * function; the visit continues across pages in the same tab, including the return
 * from Square.
 */
export function startPaymentJourney(input: {
  entry: JourneyEntry;
  link: JourneyLink;
}): () => void {
  if (typeof window === "undefined") return () => {};
  stopPaymentJourney();

  const fresh = cleanLink(input.link);
  let stored = readSession();
  if (stored && input.entry !== "complete" && !sameLink(stored.link, fresh)) {
    stored = null;
  }
  sessionId = stored?.id ?? newSessionId();
  snapshotCount = stored?.snapshots ?? 0;
  link = { ...(stored?.link ?? {}), ...fresh };
  entry = input.entry;
  writeSession();

  teardown = [onBreadcrumb(fromBreadcrumb)];
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onRejection);
  teardown.push(() => {
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onRejection);
  });
  timer = setInterval(() => flushPaymentJourney(false), FLUSH_INTERVAL_MS);

  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  journeyStep(
    "page_opened",
    [
      input.entry,
      `${window.innerWidth}x${window.innerHeight}`,
      nav.connection?.effectiveType,
      navigator.onLine ? "online" : "offline",
    ]
      .filter(Boolean)
      .join(" · "),
  );
  return stopPaymentJourney;
}

/** Adds more of the link once the page learns it, e.g. a pay code resolving to a key. */
export function updatePaymentJourneyLink(next: JourneyLink): void {
  if (!entry) return;
  link = { ...link, ...cleanLink(next) };
  writeSession();
}

export function stopPaymentJourney(): void {
  if (timer) clearInterval(timer);
  timer = null;
  flushPaymentJourney(false);
  for (const fn of teardown) fn();
  teardown = [];
  entry = null;
}

/** Records a named step such as `pay_clicked` with optional detail. */
export function journeyStep(name: string, detail?: string | number): void {
  const extra = detail === undefined || detail === "" ? "" : `: ${detail}`;
  enqueue({ t: Date.now(), type: "step", detail: `${name}${extra}` });
}

/** Resolves when `work` settles or `ms` passes, whichever comes first. Never rejects. */
export function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, Math.max(0, ms));
    work.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        resolve();
      },
    );
  });
}

function maskClone(root: Node): void {
  if (!(root instanceof Element)) return;
  for (const field of root.querySelectorAll("input, textarea")) {
    if (field instanceof HTMLInputElement) {
      if (PRIVATE_INPUT_TYPES.has(field.type)) continue;
      field.value = "";
      field.setAttribute("value", "");
    } else if (field instanceof HTMLTextAreaElement) {
      field.value = "";
      field.textContent = "";
    }
  }
}

function keepNode(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  if (node.hasAttribute("data-journey-private")) return false;
  return node.tagName !== "NEXTJS-PORTAL";
}

/** How long a Pay click may hold the redirect while its picture uploads. */
export const PAY_SNAPSHOT_WAIT_MS = 2500;

/** Takes the picture once React has painted the screen, e.g. an error message. */
export function snapshotAfterPaint(step: string): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => void captureJourneySnapshot(step), 400);
}

/**
 * Takes a picture of the page as the customer sees it, with typed values
 * blanked, and uploads it to the visit. At most four per visit.
 */
export async function captureJourneySnapshot(step: string): Promise<void> {
  if (!entry || snapshotCount >= SNAPSHOT_LIMIT || typeof document === "undefined") return;
  snapshotCount += 1;
  writeSession();
  const visitEntry = entry;
  const visitLink = link;
  const visitId = sessionId;
  const takenAt = Date.now();
  try {
    const { domToJpeg } = await import("modern-screenshot");
    const page = document.documentElement;
    const width = page.clientWidth;
    const height = Math.min(page.scrollHeight, width * 4);
    const scale = Math.min(window.devicePixelRatio || 1, 2, SNAPSHOT_MAX_WIDTH / width);
    let image = "";
    for (const quality of [0.6, 0.4]) {
      const url = await domToJpeg(page, {
        width,
        height,
        scale,
        quality,
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
        filter: keepNode,
        onCloneNode: maskClone,
      });
      image = url.slice(url.indexOf(",") + 1);
      if (image.length * 0.75 <= SNAPSHOT_MAX_BYTES) break;
      image = "";
    }
    if (!image) return;
    flushPaymentJourney(false);
    await fetch(`${API_URL}/payment-journeys/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      credentials: "omit",
      body: JSON.stringify({
        sessionId: visitId,
        entry: visitEntry,
        link: visitLink,
        step: step.slice(0, 60),
        takenAt: new Date(takenAt).toISOString(),
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        image,
      }),
    });
  } catch {
    // A failed picture must never block paying.
  }
}

const MAX_BREADCRUMBS = 100;
const MAX_DETAIL = 500;

export type BreadcrumbType =
  | "route"
  | "click"
  | "api"
  | "console"
  | "error"
  | "lifecycle";

export interface CrashBreadcrumbMeta {
  status?: number;
  durationMs?: number;
  requestId?: string;
  message?: string;
}

export interface CrashBreadcrumb {
  t: number;
  type: BreadcrumbType;
  detail: string;
  meta?: CrashBreadcrumbMeta;
}

const breadcrumbs: CrashBreadcrumb[] = [];

const SENSITIVE_PARAM =
  /^(token|access_token|refresh_token|id_token|code|password|pass|secret|key|api_key|apikey|signature|sig|auth)$/i;

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\u0000/g, "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Replaces values of sensitive query parameters with `[redacted]`. */
export function redactUrl(value: string): string {
  if (!value || !value.includes("?")) return value;
  const hashIndex = value.indexOf("#");
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = base.indexOf("?");
  const path = base.slice(0, queryIndex);
  const query = base.slice(queryIndex + 1);
  const parts = query.split("&").map((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return part;
    const name = part.slice(0, eq);
    let decoded = name;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      // Keep the raw name.
    }
    return SENSITIVE_PARAM.test(decoded) ? `${name}=[redacted]` : part;
  });
  return `${path}?${parts.join("&")}${hash}`;
}

export function pushBreadcrumb(
  type: BreadcrumbType,
  detail: string,
  meta?: CrashBreadcrumbMeta,
): void {
  const cleaned = clip(redactUrl(detail.replace(/\s+/g, " ")), MAX_DETAIL);
  if (!cleaned) return;
  const item: CrashBreadcrumb = { t: Date.now(), type, detail: cleaned };
  if (meta) {
    const next: CrashBreadcrumbMeta = {};
    if (typeof meta.status === "number") next.status = meta.status;
    if (typeof meta.durationMs === "number") {
      next.durationMs = Math.max(0, Math.round(meta.durationMs));
    }
    if (meta.requestId) next.requestId = clip(meta.requestId, 100);
    if (meta.message) next.message = clip(meta.message, 300);
    if (Object.keys(next).length > 0) item.meta = next;
  }
  breadcrumbs.push(item);
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
  }
}

export function recordRoute(path: string): void {
  pushBreadcrumb("route", path || "/");
}

export function recordApiBreadcrumb(
  method: string,
  endpoint: string,
  status: number,
  extra?: { durationMs?: number; requestId?: string; message?: string },
): void {
  try {
    const path = (endpoint.split("?")[0] || endpoint).slice(0, 300);
    if (path.includes("crash-reports")) return;
    const verb = (method || "GET").toUpperCase().slice(0, 10);
    pushBreadcrumb("api", `${verb} ${path} ${status}`, {
      status,
      durationMs: extra?.durationMs,
      requestId: extra?.requestId,
      message: status >= 400 || status === 0 ? extra?.message : undefined,
    });
  } catch {
    // Breadcrumbs must never affect the request that recorded them.
  }
}

export function copyBreadcrumbs(): CrashBreadcrumb[] {
  return breadcrumbs.slice(-MAX_BREADCRUMBS).map((item) => ({
    ...item,
    ...(item.meta ? { meta: { ...item.meta } } : {}),
  }));
}

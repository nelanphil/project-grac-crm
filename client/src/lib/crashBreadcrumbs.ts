const MAX_BREADCRUMBS = 40;
const MAX_DETAIL = 500;

export type BreadcrumbType = "route" | "click" | "api";

export interface CrashBreadcrumb {
  t: number;
  type: BreadcrumbType;
  detail: string;
}

const breadcrumbs: CrashBreadcrumb[] = [];

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\u0000/g, "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function pushBreadcrumb(type: BreadcrumbType, detail: string): void {
  const cleaned = clip(detail.replace(/\s+/g, " "), MAX_DETAIL);
  if (!cleaned) return;
  breadcrumbs.push({ t: Date.now(), type, detail: cleaned });
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
): void {
  try {
    const path = (endpoint.split("?")[0] || endpoint).slice(0, 300);
    if (path.includes("crash-reports")) return;
    const verb = (method || "GET").toUpperCase().slice(0, 10);
    pushBreadcrumb("api", `${verb} ${path} ${status}`);
  } catch {
    // Breadcrumbs must never affect the request that recorded them.
  }
}

export function copyBreadcrumbs(): CrashBreadcrumb[] {
  return breadcrumbs.slice(-MAX_BREADCRUMBS).map((item) => ({ ...item }));
}

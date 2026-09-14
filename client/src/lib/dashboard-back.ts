const STORAGE_PREV = "grac:dashboard:prevPath";
const STORAGE_CURR = "grac:dashboard:currPath";
const CHANGE_EVENT = "grac:dashboard-back-change";

const TRANSIENT_FORM_PATHS = [
  "/dashboard/work-orders/create",
  "/dashboard/estimates/create",
  "/dashboard/estimates/templates/create",
  "/dashboard/customers/create",
];

const PATH_LABELS: { prefix: string; label: string }[] = [
  { prefix: "/dashboard/customers/detail", label: "Back to customer" },
  { prefix: "/dashboard/customers/notes", label: "Back to notes" },
  { prefix: "/dashboard/customers/create", label: "Back to add customer" },
  { prefix: "/dashboard/customers/all", label: "Back to customers" },
  { prefix: "/dashboard/customers", label: "Back to customers" },
  { prefix: "/dashboard/work-orders/detail", label: "Back to work order" },
  { prefix: "/dashboard/work-orders/create", label: "Back to new work order" },
  { prefix: "/dashboard/work-orders", label: "Back to work orders" },
  { prefix: "/dashboard/estimates/detail", label: "Back to estimate" },
  { prefix: "/dashboard/estimates/create", label: "Back to new estimate" },
  { prefix: "/dashboard/estimates/templates/edit", label: "Back to edit template" },
  { prefix: "/dashboard/estimates/templates/create", label: "Back to new template" },
  { prefix: "/dashboard/estimates/templates", label: "Back to estimate templates" },
  { prefix: "/dashboard/estimates", label: "Back to estimates" },
  { prefix: "/dashboard/orders/detail", label: "Back to invoice" },
  { prefix: "/dashboard/orders", label: "Back to invoices" },
  { prefix: "/dashboard/contracts/edit", label: "Back to contract" },
  { prefix: "/dashboard/contracts", label: "Back to contracts" },
  { prefix: "/dashboard/schedule", label: "Back to schedule" },
  { prefix: "/dashboard/leads", label: "Back to leads" },
  { prefix: "/dashboard/contact", label: "Back to contact" },
  { prefix: "/dashboard/messaging/history", label: "Back to message history" },
  { prefix: "/dashboard/messaging", label: "Back to messaging" },
  { prefix: "/dashboard/users/roles", label: "Back to roles" },
  { prefix: "/dashboard/users", label: "Back to users" },
  { prefix: "/dashboard/control-panel", label: "Back to control panel" },
  { prefix: "/dashboard/settings", label: "Back to settings" },
  { prefix: "/dashboard/admin", label: "Back to admin" },
  { prefix: "/dashboard/financials", label: "Back to financials" },
  { prefix: "/dashboard/products", label: "Back to products" },
  { prefix: "/dashboard/services", label: "Back to services" },
  { prefix: "/dashboard/discount-codes", label: "Back to discount codes" },
  { prefix: "/dashboard/territory", label: "Back to territory" },
  { prefix: "/dashboard/notifications", label: "Back to notifications" },
  { prefix: "/dashboard/checkout", label: "Back to checkout" },
  { prefix: "/dashboard", label: "Back to dashboard" },
];

export function safeDashboardPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/dashboard")) return null;
  if (value.startsWith("//") || value.includes("://") || value.includes("..")) return null;
  return value;
}

function pathnameOf(path: string): string {
  const raw = (path.split("?")[0] ?? path).replace(/\/+$/, "") || "/";
  return raw;
}

export function isTransientFormPath(path: string): boolean {
  const pathname = pathnameOf(path);
  return TRANSIENT_FORM_PATHS.some((prefix) => pathname === prefix);
}

export function labelForDashboardPath(path: string): string {
  const pathname = pathnameOf(path);
  const match = PATH_LABELS.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
  );
  return match?.label ?? "Back";
}

export function dashboardPathFromLocation(pathname: string, search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return query ? `${pathname}?${query}` : pathname;
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return safeDashboardPath(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  sessionStorage.setItem(key, value);
}

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function recordDashboardPath(path: string) {
  if (typeof window === "undefined") return;
  const current = safeDashboardPath(path);
  if (!current) return;

  try {
    const previousCurrent = readStorage(STORAGE_CURR);
    if (previousCurrent && previousCurrent !== current && !isTransientFormPath(previousCurrent)) {
      writeStorage(STORAGE_PREV, previousCurrent);
    }
    writeStorage(STORAGE_CURR, current);
    emitChange();
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function getDashboardBackHref(currentPath: string): string | null {
  const storedCurrent = readStorage(STORAGE_CURR);
  if (
    storedCurrent &&
    storedCurrent !== currentPath &&
    !isTransientFormPath(storedCurrent)
  ) {
    return storedCurrent;
  }

  const previous = readStorage(STORAGE_PREV);
  if (previous && previous !== currentPath) return previous;
  return null;
}

export function resolveDashboardBackTarget(options: {
  currentPath: string;
  fallbackHref: string;
  fallbackLabel?: string;
  returnTo?: string | null;
}): { href: string; label: string } {
  const explicit = safeDashboardPath(options.returnTo);
  if (explicit) {
    return { href: explicit, label: labelForDashboardPath(explicit) };
  }

  const previous = getDashboardBackHref(options.currentPath);
  if (previous) {
    return { href: previous, label: labelForDashboardPath(previous) };
  }

  const fallback = safeDashboardPath(options.fallbackHref) ?? "/dashboard";
  return {
    href: fallback,
    label: options.fallbackLabel ?? labelForDashboardPath(fallback),
  };
}

export function subscribeDashboardBack(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange);
}

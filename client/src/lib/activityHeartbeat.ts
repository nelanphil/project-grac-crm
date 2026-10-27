import { authTouchActivity } from "@/lib/api";

const COOLDOWN_MS = 5 * 60 * 1000;
const STORAGE_PREFIX = "activity-touch:";

const inFlight = new Set<string>();

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function activityOnCooldown(userId: string): boolean {
  if (!userId) return true;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markActivityTouched(userId: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), String(Date.now()));
  } catch {
    // Private browsing can block storage. The next interaction may ping again.
  }
}

/** Tell the API this user is active. Skips when a ping succeeded in the last 5 minutes. */
export function touchActivity(token: string, userId: string): void {
  if (!token || !userId) return;
  if (activityOnCooldown(userId) || inFlight.has(userId)) return;
  inFlight.add(userId);
  authTouchActivity(token)
    .then((saved) => {
      if (saved) markActivityTouched(userId);
    })
    .catch(() => {})
    .finally(() => {
      inFlight.delete(userId);
    });
}

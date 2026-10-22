import type { CustomerActivityItem } from "./customerActivity.service";

type ActivityListener = (item: CustomerActivityItem) => void;

const listeners = new Map<string, Set<ActivityListener>>();
const allListeners = new Set<ActivityListener>();

/**
 * In-process fan-out for one API process. A second server instance will not
 * see these events; the client refetches the gap when its stream reconnects.
 */
export function subscribeCustomerActivity(
  customerId: string,
  listener: ActivityListener,
): () => void {
  const key = String(customerId);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
}

export function subscribeAllCustomerActivity(
  listener: ActivityListener,
): () => void {
  allListeners.add(listener);
  return () => {
    allListeners.delete(listener);
  };
}

export function publishCustomerActivity(
  customerId: string,
  item: CustomerActivityItem,
): void {
  const set = listeners.get(String(customerId));
  const targets = [...(set ?? []), ...allListeners];
  for (const listener of targets) {
    try {
      listener(item);
    } catch (err) {
      console.error("[customer-activity] listener failed:", err);
    }
  }
}

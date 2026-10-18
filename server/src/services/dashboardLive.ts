type DashboardListener = () => void;

const listeners = new Set<DashboardListener>();

export function subscribeDashboardLive(listener: DashboardListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tell every open staff dashboard to refresh. No-op when nobody is listening. */
export function publishDashboardChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("[dashboard-live] listener failed:", err);
    }
  }
}

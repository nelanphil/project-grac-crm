import { API_URL } from "@/lib/api";

type DashboardListener = () => void;

let liveToken: string | null = null;
let liveAbort: AbortController | null = null;
const listeners = new Set<DashboardListener>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notifyDashboardLive(): void {
  for (const listener of listeners) listener();
}

async function readDashboardEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: () => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let splitAt = buffer.indexOf("\n\n");
      while (splitAt !== -1) {
        const frame = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        if (frame.split("\n").some((line) => line.startsWith("data:"))) {
          onEvent();
        }
        splitAt = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function runLive(token: string, signal: AbortSignal): Promise<void> {
  let notifyOnOpen = false;
  let delay = 1_000;
  while (!signal.aborted && liveToken === token) {
    try {
      const res = await fetch(`${API_URL}/dashboard/live`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal,
      });
      if (signal.aborted || liveToken !== token) return;
      if (!res.ok || !res.body) throw new Error("dashboard live closed");
      if (notifyOnOpen) notifyDashboardLive();
      notifyOnOpen = true;
      delay = 1_000;
      await readDashboardEvents(res.body, notifyDashboardLive, signal);
    } catch {
      if (signal.aborted || liveToken !== token) return;
    }
    if (signal.aborted || liveToken !== token) return;
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }
}

function ensureLive(token: string): void {
  if (liveToken === token && liveAbort) return;
  liveAbort?.abort();
  liveToken = token;
  liveAbort = new AbortController();
  void runLive(token, liveAbort.signal);
}

function stopLive(): void {
  liveAbort?.abort();
  liveAbort = null;
  liveToken = null;
}

/** Share one dashboard event stream across every open view. */
export function subscribeDashboardLive(
  token: string,
  listener: DashboardListener,
): () => void {
  listeners.add(listener);
  ensureLive(token);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopLive();
  };
}

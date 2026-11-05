"use client";

import { useEffect, useState } from "react";
import { getInboxUnreadAlert } from "@/lib/api";
import { subscribeDashboardLive } from "@/lib/dashboardLive";
import { useAuthStore } from "@/store/useAuthStore";

const POLL_MS = 30_000;
const DEBOUNCE_MS = 750;

type Listener = (hasUnread: boolean) => void;

let hasUnread = false;
let activeToken: string | null = null;
let subscribers = 0;
let requestId = 0;
const listeners = new Set<Listener>();
let stopLive: (() => void) | null = null;
let pollId: number | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let onFocus: (() => void) | null = null;
let onVisibility: (() => void) | null = null;

function notify(next: boolean): void {
  if (next === hasUnread) return;
  hasUnread = next;
  for (const listener of listeners) listener(hasUnread);
}

async function load(token: string): Promise<void> {
  const id = ++requestId;
  try {
    const result = await getInboxUnreadAlert(token);
    if (id !== requestId || activeToken !== token) return;
    notify(result.hasUnread);
  } catch {
    // A failed check leaves the dot as it was.
  }
}

function stop(reset: boolean): void {
  requestId += 1;
  stopLive?.();
  stopLive = null;
  if (pollId != null) {
    window.clearInterval(pollId);
    pollId = null;
  }
  if (liveTimer) {
    clearTimeout(liveTimer);
    liveTimer = null;
  }
  if (onFocus) {
    window.removeEventListener("focus", onFocus);
    onFocus = null;
  }
  if (onVisibility) {
    document.removeEventListener("visibilitychange", onVisibility);
    onVisibility = null;
  }
  activeToken = null;
  if (reset) notify(false);
}

function ensure(token: string): void {
  if (activeToken === token && stopLive) return;
  stop(false);
  activeToken = token;
  void load(token);
  stopLive = subscribeDashboardLive(token, () => {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (activeToken) void load(activeToken);
    }, DEBOUNCE_MS);
  });
  pollId = window.setInterval(() => {
    if (activeToken) void load(activeToken);
  }, POLL_MS);
  onFocus = () => {
    if (activeToken) void load(activeToken);
  };
  onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    if (activeToken) void load(activeToken);
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
}

/** Refetch after this tab marks a chat read or unread. */
export function refreshInboxUnread(): void {
  if (activeToken) void load(activeToken);
}

/** Shared unread flag for every Inboxes nav surface. */
export function useInboxUnread(): boolean {
  const token = useAuthStore((state) => state.token);
  const canRead = useAuthStore((state) => state.hasPermission("messages:read"));
  const [unread, setUnread] = useState(hasUnread);

  useEffect(() => {
    if (!token || !canRead) return;
    const onChange: Listener = (next) => setUnread(next);
    listeners.add(onChange);
    subscribers += 1;
    ensure(token);
    queueMicrotask(() => onChange(hasUnread));
    return () => {
      listeners.delete(onChange);
      subscribers -= 1;
      if (subscribers === 0) stop(true);
    };
  }, [token, canRead]);

  if (!token || !canRead) return false;
  return unread;
}

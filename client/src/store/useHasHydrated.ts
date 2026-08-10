"use client";

import { useSyncExternalStore } from "react";
import { useAuthStore } from "@/store/useAuthStore";

function subscribe(callback: () => void) {
  return useAuthStore.persist.onFinishHydration(callback);
}

function getSnapshot() {
  return useAuthStore.persist.hasHydrated();
}

function getServerSnapshot() {
  return false;
}

/**
 * Returns whether the persisted auth store has finished rehydrating from
 * localStorage.
 *
 * Starts as `false` on both the server and the client's first render so there
 * is no SSR hydration mismatch. Uses `useSyncExternalStore` so React (rather
 * than a synchronous `setState` inside an effect) drives the re-render when
 * hydration finishes.
 *
 * Gating auth checks on this prevents a page refresh from briefly seeing
 * `isAuthenticated === false` and logging the user out.
 */
export function useHasHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

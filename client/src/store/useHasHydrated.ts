"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Returns whether the persisted auth store has finished rehydrating from
 * localStorage.
 *
 * Starts as `false` on both the server and the client's first render so there
 * is no SSR hydration mismatch. It then flips to `true` from an effect, which:
 *  - checks `hasHydrated()` immediately (zustand v5 rehydrates synchronous
 *    storage before this effect runs, so `onFinishHydration` may have already
 *    fired and would otherwise be missed), and
 *  - subscribes to `onFinishHydration` for the async-storage case.
 *
 * Gating auth checks on this prevents a page refresh from briefly seeing
 * `isAuthenticated === false` and logging the user out.
 */
export function useHasHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() =>
    typeof window === "undefined" ? false : useAuthStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (hydrated) {
      return;
    }
    const unsub = useAuthStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, [hydrated]);

  return hydrated;
}

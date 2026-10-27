"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

async function fetchCurrentVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" && data.version ? data.version : null;
  } catch {
    // Network blip, offline, or version.json not deployed yet.
    return null;
  }
}

/**
 * Detects a new production frontend by comparing `/version.json` (written at
 * build time from content-hashed chunks) with the version captured at load.
 * Polling is gated on a signed-in session and a visible tab, and is disabled
 * in development.
 */
export function useBuildVersionCheck(): {
  updateAvailable: boolean;
  dismiss: () => void;
} {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialVersionRef = useRef<string | null>(null);
  const latestVersionRef = useRef<string | null>(null);
  const dismissedVersionRef = useRef<string | null>(null);
  const token = useAuthStore((s) => s.token);

  const dismiss = useCallback(() => {
    dismissedVersionRef.current = latestVersionRef.current;
    setUpdateAvailable(false);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;

    const check = async () => {
      if (!useAuthStore.getState().token) return;
      if (document.visibilityState !== "visible") return;

      const version = await fetchCurrentVersion();
      if (cancelled || !version) return;

      latestVersionRef.current = version;

      if (initialVersionRef.current === null) {
        initialVersionRef.current = version;
        return;
      }

      if (
        version !== initialVersionRef.current &&
        version !== dismissedVersionRef.current
      ) {
        setUpdateAvailable(true);
      }
    };

    void check();

    const interval = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);

  return { updateAvailable, dismiss };
}

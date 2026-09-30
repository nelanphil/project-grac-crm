"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";
import { THEME_EVENT, applyThemeForPath, resolveTheme } from "@/lib/theme";

/** Keeps `data-theme` on `<html>` aligned with the saved choice and the route. */
export default function ThemeSync() {
  const pathname = usePathname();
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!hydrated) return;

    function sync() {
      applyThemeForPath(resolveTheme(isAuthenticated), pathname);
    }

    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, [pathname, hydrated, isAuthenticated]);

  return null;
}

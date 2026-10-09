"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";
import {
  THEME_EVENT,
  getExplicitTheme,
  setTheme,
  type Theme,
} from "@/lib/theme";

interface Props {
  /** Visual variant for dark headers vs light staff chrome. */
  variant?: "dark" | "light";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getServerSnapshot(): Theme | null {
  return null;
}

export default function ThemeToggle({ variant = "dark" }: Props) {
  const pathname = usePathname();
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const explicit = useSyncExternalStore(
    subscribe,
    getExplicitTheme,
    getServerSnapshot,
  );

  if (!hydrated || !isAuthenticated) return null;

  const isDark = (explicit ?? "dark") === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark", pathname)}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-md p-2 transition-colors ${
        variant === "light"
          ? "text-[var(--staff-muted)] hover:bg-[var(--staff-cream)] hover:text-[var(--staff-ink)]"
          : "text-white/80 hover:text-brand-orange"
      }`}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

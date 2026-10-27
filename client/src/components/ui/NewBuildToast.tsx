"use client";

import { X } from "lucide-react";
import { useBuildVersionCheck } from "@/hooks/useBuildVersionCheck";

export default function NewBuildToast() {
  const { updateAvailable, dismiss } = useBuildVersionCheck();

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 print:hidden">
      <div className="flex items-center gap-3 rounded-2xl bg-[var(--staff-ink)] px-4 py-3 text-[var(--staff-surface)] shadow-lg">
        <p className="flex-1 text-sm">
          A new version is available. Refresh to get the latest update.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-full bg-brand-orange px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange/90"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--staff-surface)]/80 transition-colors hover:bg-white/10 hover:text-[var(--staff-surface)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

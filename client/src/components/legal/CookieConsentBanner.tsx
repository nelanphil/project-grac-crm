"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/useAuthStore";
import {
  useConsentStore,
  type CookieConsentStatus,
} from "@/store/useConsentStore";

export default function CookieConsentBanner() {
  // Always false on first server + client render to avoid hydration mismatch.
  // Flip true only in effects after Zustand rehydration.
  const [ready, setReady] = useState(false);

  const cookieConsentStatus = useConsentStore((s) => s.cookieConsentStatus);
  const setCookieConsent = useConsentStore((s) => s.setCookieConsent);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userConsentStatus = useAuthStore((s) => s.user?.cookieConsentStatus);
  const setAuthCookieConsent = useAuthStore((s) => s.setCookieConsentStatus);

  useEffect(() => {
    let cancelled = false;

    function markReady() {
      if (!cancelled) setReady(true);
    }

    const authDone = useAuthStore.persist.hasHydrated();
    const consentDone = useConsentStore.persist.hasHydrated();

    if (authDone && consentDone) {
      markReady();
      return;
    }

    const unsubs: Array<() => void> = [];
    if (!authDone) {
      unsubs.push(useAuthStore.persist.onFinishHydration(tryReady));
    }
    if (!consentDone) {
      unsubs.push(useConsentStore.persist.onFinishHydration(tryReady));
    }

    function tryReady() {
      if (
        useAuthStore.persist.hasHydrated() &&
        useConsentStore.persist.hasHydrated()
      ) {
        markReady();
      }
    }

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  // Sync guest ↔ logged-in mirrors after both stores rehydrate.
  useEffect(() => {
    if (!ready) return;

    if (cookieConsentStatus && isAuthenticated && !userConsentStatus) {
      setAuthCookieConsent(cookieConsentStatus);
      return;
    }

    if (
      userConsentStatus &&
      !cookieConsentStatus &&
      (userConsentStatus === "accepted" || userConsentStatus === "declined")
    ) {
      setCookieConsent(userConsentStatus);
    }
  }, [
    ready,
    cookieConsentStatus,
    isAuthenticated,
    userConsentStatus,
    setAuthCookieConsent,
    setCookieConsent,
  ]);

  const decided =
    cookieConsentStatus != null ||
    (isAuthenticated && userConsentStatus != null);

  if (!ready || decided) {
    return null;
  }

  function decide(status: CookieConsentStatus) {
    setCookieConsent(status);
    if (useAuthStore.getState().isAuthenticated) {
      setAuthCookieConsent(status);
    }
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white/95 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur-sm"
      role="dialog"
      aria-label="Cookie consent"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-neutral-700">
          We use essential cookies to run this site and remember your preferences.
          Optional cookies help us understand how the site is used. See our{" "}
          <Link
            href="/privacy"
            className="font-medium text-brand-orange underline-offset-2 hover:underline"
          >
            Privacy Policy
          </Link>{" "}
          for details.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("declined")}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-brand-dark transition-colors hover:bg-neutral-50"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

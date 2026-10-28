"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore, userNeedsLegalConsent } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Wraps protected pages. Redirects to /auth/login if the user is not
 * authenticated. Customers who still need legal consent are sent to
 * /auth/legal-consent. Must be rendered client-side only.
 *
 * Waits for zustand persist rehydration so a refresh does not briefly
 * see isAuthenticated=false and kick the user to login.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setRedirectAfterAuth = useAuthStore((s) => s.setRedirectAfterAuth);
  const needsLegalConsent = userNeedsLegalConsent(user);
  const hydrated = useHasHydrated();

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      const here = `${window.location.pathname}${window.location.search}`;
      if (here.startsWith("/") && !here.startsWith("//")) {
        setRedirectAfterAuth(here);
      }
      router.replace("/auth/login");
      return;
    }
    if (needsLegalConsent) {
      router.replace("/auth/legal-consent");
    }
  }, [hydrated, isAuthenticated, needsLegalConsent, router, setRedirectAfterAuth]);

  if (!hydrated || !isAuthenticated || needsLegalConsent) return null;

  return <>{children}</>;
}

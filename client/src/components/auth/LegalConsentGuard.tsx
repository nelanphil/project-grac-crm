"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore, userNeedsLegalConsent } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";

interface LegalConsentGuardProps {
  children: React.ReactNode;
}

/**
 * Ensures the user is authenticated and still needs legal consent.
 * Unauthenticated → login. Already consented → dashboard.
 */
export default function LegalConsentGuard({ children }: LegalConsentGuardProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const needsLegalConsent = userNeedsLegalConsent(user);
  const hydrated = useHasHydrated();

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      router.replace("/auth/login");
      return;
    }
    if (!needsLegalConsent) {
      router.replace("/dashboard");
    }
  }, [hydrated, isAuthenticated, needsLegalConsent, router]);

  if (!hydrated || !isAuthenticated || !needsLegalConsent) return null;

  return <>{children}</>;
}

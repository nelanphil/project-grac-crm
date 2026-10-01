"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore, userNeedsLegalConsent } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";

/**
 * Sends an authenticated visitor away from the public homepage.
 * Full page loads are redirected before paint by the head script in the root layout.
 * This covers client-side navigations to `/`, where that script does not run again.
 */
export default function HomeAuthRedirect() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const needsLegalConsent = userNeedsLegalConsent(user);
  const hydrated = useHasHydrated();

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    router.replace(needsLegalConsent ? "/auth/legal-consent" : "/dashboard");
  }, [hydrated, isAuthenticated, needsLegalConsent, router]);

  return null;
}

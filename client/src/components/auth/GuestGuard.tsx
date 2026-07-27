"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";

interface GuestGuardProps {
  children: React.ReactNode;
}

/**
 * Wraps guest-only pages (e.g. login). Redirects to /dashboard if the user is
 * already authenticated. Must be rendered client-side only.
 *
 * Waits for zustand persist rehydration so a refresh does not briefly see
 * isAuthenticated=false and render the login page to an already-authed user.
 */
export default function GuestGuard({ children }: GuestGuardProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrated = useHasHydrated();

  useEffect(() => {
    if (hydrated && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated || isAuthenticated) return null;

  return <>{children}</>;
}

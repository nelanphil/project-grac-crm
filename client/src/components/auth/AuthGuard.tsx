"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Wraps protected pages. Redirects to /auth/login if the user is not
 * authenticated. Must be rendered client-side only.
 *
 * Waits for zustand persist rehydration so a refresh does not briefly
 * see isAuthenticated=false and kick the user to login.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [hydrated, setHydrated] = useState(
    () => useAuthStore.persist?.hasHydrated() ?? false,
  );

  useEffect(() => {
    return useAuthStore.persist?.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace("/auth/login");
    }
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated || !isAuthenticated) return null;

  return <>{children}</>;
}

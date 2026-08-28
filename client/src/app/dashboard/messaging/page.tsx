"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import MessagingHub from "@/components/messaging/MessagingHub";
import { useAuthStore } from "@/store/useAuthStore";

const ADMIN_ROLES = ["admin", "super-admin", "owner"];

export default function MessagingPage() {
  return (
    <AuthGuard>
      <MessagingPageContent />
    </AuthGuard>
  );
}

function MessagingPageContent() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  useEffect(() => {
    if (user && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isAdmin, router]);

  if (!user || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Messages</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Templates, conversations, and call transcripts.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="text-sm text-neutral-500">Loading messages…</div>
        }
      >
        <MessagingHub />
      </Suspense>
    </div>
  );
}

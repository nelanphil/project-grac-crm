"use client";

import { Suspense } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import MessagingHub from "@/components/messaging/MessagingHub";

export default function MessagingPage() {
  return (
    <AuthGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Messages</h1>
        </div>

        <Suspense
          fallback={
            <div className="text-sm text-neutral-500">Loading messages…</div>
          }
        >
          <MessagingHub />
        </Suspense>
      </div>
    </AuthGuard>
  );
}

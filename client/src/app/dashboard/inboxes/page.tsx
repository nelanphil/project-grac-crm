"use client";

import { Suspense } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import InboxesWorkspace from "@/components/inboxes/InboxesWorkspace";

export default function InboxesPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={<div className="text-sm text-neutral-500">Loading inboxes…</div>}
      >
        <InboxesWorkspace />
      </Suspense>
    </AuthGuard>
  );
}

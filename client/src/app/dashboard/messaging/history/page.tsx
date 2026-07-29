"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";

export default function MessagingHistoryRedirect() {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <RedirectContent />
      </Suspense>
    </AuthGuard>
  );
}

function RedirectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contactId = searchParams.get("contactId");

  useEffect(() => {
    const params = new URLSearchParams({ tab: "threads" });
    if (contactId) params.set("contactId", contactId);
    router.replace(`/dashboard/messaging?${params.toString()}`);
  }, [router, contactId]);

  return null;
}

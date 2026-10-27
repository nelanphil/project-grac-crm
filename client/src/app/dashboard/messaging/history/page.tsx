"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";

export default function MessagingHistoryRedirect() {
  return (
    <AuthGuard>
      <RedirectContent />
    </AuthGuard>
  );
}

function RedirectContent() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/inboxes");
  }, [router]);

  return null;
}

"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

export default function ShortPayRedirect({ code }: { code: string }) {
  const trimmed = code.trim();
  const reserved = !trimmed || trimmed.toLowerCase() === "preview";
  const [message, setMessage] = useState(
    reserved ? "Payment link not found." : "Opening checkout…",
  );

  useEffect(() => {
    if (reserved) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          `${API_URL}/checkout/code/${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) {
          if (!cancelled) setMessage("Payment link not found.");
          return;
        }
        const data = (await res.json()) as { checkoutKey?: string };
        if (!data.checkoutKey) {
          if (!cancelled) setMessage("Payment link not found.");
          return;
        }
        window.location.replace(
          `/checkout/?c=${encodeURIComponent(data.checkoutKey)}`,
        );
      } catch {
        if (!cancelled) setMessage("Payment link not found.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, reserved, trimmed]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <p className="text-sm text-neutral-600">{message}</p>
    </main>
  );
}

"use client";

import { useMemo } from "react";
import { CrashModal } from "@/components/crash/CrashBoundary";
import { captureError } from "@/lib/crashReport";
import "./globals.css";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const crash = useMemo(
    () =>
      captureError({
        source: "render",
        name: error.name,
        message: error.message || "The application crashed.",
        stack: error.stack,
      }),
    [error],
  );

  return (
    <html lang="en">
      <body className="min-h-full bg-white text-brand-dark">
        <CrashModal crash={crash} />
      </body>
    </html>
  );
}

"use client";

import { useLayoutEffect } from "react";

/** Matches `/p/Ab12Cd34` with an optional trailing slash. */
const PAY_CODE_PATH = /^\/p\/([A-Za-z0-9_-]+)\/?$/;

export default function NotFound() {
  useLayoutEffect(() => {
    const code = PAY_CODE_PATH.exec(window.location.pathname)?.[1];
    if (!code) return;
    window.location.replace(`/checkout/?p=${encodeURIComponent(code)}`);
  }, []);

  return (
    <main className="flex min-h-[50vh] items-center justify-center px-4">
      <p className="text-sm text-neutral-600">This page could not be found.</p>
    </main>
  );
}

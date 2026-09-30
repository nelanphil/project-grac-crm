"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import CookieConsentBanner from "@/components/legal/CookieConsentBanner";
import ScrollToTopButton from "@/components/ui/ScrollToTopButton";
import ThemeSync from "@/components/theme/ThemeSync";

function normalizePath(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

const BARE_PATHS = new Set(["/sms-program", "/sms-opt-in"]);

const NO_COOKIE_BANNER_PATHS = new Set([
  "/sms-program",
  "/sms-opt-in",
  "/privacy",
  "/terms",
  "/auth/signup",
]);

export default function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const path = normalizePath(pathname);
  const bare = BARE_PATHS.has(path);

  if (bare) {
    return (
      <>
        <ThemeSync />
        <main className="flex-1">{children}</main>
      </>
    );
  }

  return (
    <>
      <ThemeSync />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      {!NO_COOKIE_BANNER_PATHS.has(path) ? <CookieConsentBanner /> : null}
      <ScrollToTopButton />
    </>
  );
}

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import CookieConsentBanner from "@/components/legal/CookieConsentBanner";
import ScrollToTopButton from "@/components/ui/ScrollToTopButton";

function normalizePath(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export default function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = normalizePath(pathname) === "/sms-program";

  if (bare) {
    return <main className="flex-1">{children}</main>;
  }

  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <CookieConsentBanner />
      <ScrollToTopButton />
    </>
  );
}

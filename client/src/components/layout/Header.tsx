"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Settings, LogOut } from "lucide-react";
import { NAV_LINKS, COMPANY, ESTIMATE_ROUTE } from "@/lib/constants";
import { useAuthStore } from "@/store/useAuthStore";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isDashboard = pathname.startsWith("/dashboard");

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href.startsWith("/#")) return pathname === "/";
    return pathname === href;
  };

  function handleLogout() {
    logout();
    router.push("/auth/login");
  }

  // ── Dashboard header ──────────────────────────────────────────────────────
  if (isDashboard) {
    return (
      <header className="sticky top-0 z-50 bg-brand-dark text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="text-lg font-bold tracking-tight transition-colors hover:text-brand-orange sm:text-xl"
          >
            Generator Maintenance
            <span className="text-brand-orange"> of Florida</span>
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="/dashboard/settings"
              className="rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange"
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
    );
  }

  // ── Public / landing header ───────────────────────────────────────────────
  return (
    <header className="sticky top-0 z-50 bg-brand-dark text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight transition-colors hover:text-brand-orange sm:text-xl"
        >
          Generator Maintenance
          <span className="text-brand-orange"> of Florida</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-brand-orange ${
                isActive(link.href) ? "text-brand-orange" : "text-white/90"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <a
            href={COMPANY.phoneHref}
            className="text-sm font-medium text-white/90 transition-colors hover:text-brand-orange"
          >
            {COMPANY.phone}
          </a>
          <Link
            href="/auth/login"
            className={`text-sm font-medium transition-colors hover:text-brand-orange ${
              pathname === "/auth/login" ? "text-brand-orange" : "text-white/90"
            }`}
          >
            Login
          </Link>
          <Link href={ESTIMATE_ROUTE} className="btn-primary px-5 py-2 text-sm">
            Get Your Estimate
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-white md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            {mobileOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-white/10 px-4 pb-4 md:hidden">
          <nav className="flex flex-col gap-3 pt-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium ${
                  isActive(link.href) ? "text-brand-orange" : "text-white/90"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <a
              href={COMPANY.phoneHref}
              className="text-sm font-medium text-white/90"
              onClick={() => setMobileOpen(false)}
            >
              {COMPANY.phone}
            </a>
            <Link
              href="/auth/login"
              className={`text-sm font-medium ${
                pathname === "/auth/login"
                  ? "text-brand-orange"
                  : "text-white/90"
              }`}
              onClick={() => setMobileOpen(false)}
            >
              Login
            </Link>
            <Link
              href={ESTIMATE_ROUTE}
              className="btn-primary w-fit px-5 py-2 text-sm"
              onClick={() => setMobileOpen(false)}
            >
              Get Your Estimate
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

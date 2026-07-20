"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Home, Settings, LogOut, Menu, X } from "lucide-react";
import { NAV_LINKS, COMPANY, ESTIMATE_ROUTE } from "@/lib/constants";
import { getVisibleNavSections } from "@/lib/dashboard-nav";
import { useAuthStore } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";

const HEADER_CONTAINER =
  "mx-auto flex w-full max-w-none items-center justify-between px-4 py-4 sm:px-6 lg:px-10";

const BRAND_LINK_CLASS =
  "text-lg font-bold tracking-tight transition-colors hover:text-brand-orange sm:text-xl";

function BrandLink() {
  return (
    <Link href="/" className={BRAND_LINK_CLASS}>
      <span className="md:hidden">
        G<span className="text-brand-orange">MOF</span>
      </span>
      <span className="hidden md:inline">
        Generator Maintenance
        <span className="text-brand-orange"> of Florida</span>
      </span>
    </Link>
  );
}

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [mobileOpen, setMobileOpen] = useState(false);
  const hydrated = useHasHydrated();

  const isDashboard = pathname.startsWith("/dashboard");
  const showAuthedActions = hydrated && isAuthenticated;

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
    const visibleSections = getVisibleNavSections(user?.role);
    const settingsActive = pathname.startsWith("/dashboard/settings");

    return (
      <header className="sticky top-0 z-50 bg-brand-dark text-white">
        <div className={HEADER_CONTAINER}>
          <BrandLink />

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
            <Link
              href="/dashboard"
              className="hidden rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange md:block"
              aria-label="Go to dashboard"
            >
              <Home className="h-5 w-5" />
            </Link>
            <Link
              href="/dashboard/settings"
              className="hidden rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange md:block"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="hidden rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange md:block"
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-white/10 px-4 pb-4 md:hidden">
            <nav className="flex flex-col gap-5 pt-4">
              {visibleSections.map((section) => (
                <div key={section.label}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
                    {section.label}
                  </p>
                  <div className="flex flex-col gap-1">
                    {section.items.map(({ href, label, icon: Icon }) => {
                      const active =
                        pathname === href || pathname.startsWith(`${href}/`);
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                            active
                              ? "bg-brand-orange text-white"
                              : "text-white/90 hover:bg-white/10"
                          }`}
                          onClick={() => setMobileOpen(false)}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
                  Account
                </p>
                <Link
                  href="/dashboard"
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    pathname === "/dashboard"
                      ? "bg-brand-orange text-white"
                      : "text-white/90 hover:bg-white/10"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  <Home className="h-4 w-4 shrink-0" />
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/settings"
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    settingsActive
                      ? "bg-brand-orange text-white"
                      : "text-white/90 hover:bg-white/10"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Sign out
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>
    );
  }

  // ── Public / landing header ───────────────────────────────────────────────
  return (
    <header className="sticky top-0 z-50 bg-brand-dark text-white">
      <div className={HEADER_CONTAINER}>
        <BrandLink />

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
          {!showAuthedActions && (
            <Link
              href="/auth/login"
              className={`text-sm font-medium transition-colors hover:text-brand-orange ${
                pathname === "/auth/login"
                  ? "text-brand-orange"
                  : "text-white/90"
              }`}
            >
              Login
            </Link>
          )}
          <Link href={ESTIMATE_ROUTE} className="btn-primary px-5 py-2 text-sm">
            Get Your Estimate
          </Link>
          {showAuthedActions && (
            <div className="flex items-center gap-1">
              <Link
                href="/dashboard"
                className="rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange"
                aria-label="Go to dashboard"
              >
                <Home className="h-5 w-5" />
              </Link>
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
          )}
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
            {showAuthedActions ? (
              <>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-3 text-sm font-medium text-white/90"
                  onClick={() => setMobileOpen(false)}
                >
                  <Home className="h-4 w-4 shrink-0" />
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/settings"
                  className="flex items-center gap-3 text-sm font-medium text-white/90"
                  onClick={() => setMobileOpen(false)}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    handleLogout();
                  }}
                  className="flex items-center gap-3 text-sm font-medium text-white/90"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Sign out
                </button>
              </>
            ) : (
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
            )}
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

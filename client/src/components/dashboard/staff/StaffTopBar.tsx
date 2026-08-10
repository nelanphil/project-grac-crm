"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, Plus, X } from "lucide-react";
import { COMPANY } from "@/lib/constants";
import { getVisibleNavSections } from "@/lib/dashboard-nav";
import { useAuthStore } from "@/store/useAuthStore";
import NotificationBell from "@/components/notifications/NotificationBell";
import NavItemGroup from "@/components/dashboard/NavItemGroup";
import CustomerHeaderSearch from "@/components/dashboard/staff/CustomerHeaderSearch";

export default function StaffTopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const canWriteCustomers = useAuthStore((s) =>
    s.hasPermission("customers:write"),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const visibleSections = getVisibleNavSections(user?.role);
  const initials =
    `${user?.first_name?.[0] ?? ""}${user?.last_name?.[0] ?? ""}`.toUpperCase() ||
    "U";

  function handleLogout() {
    logout();
    router.push("/auth/login");
  }

  function closeMenus() {
    setMobileOpen(false);
    setNewOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--staff-border)] bg-[var(--staff-surface)]/95 backdrop-blur">
      <div className="flex items-center gap-3 px-3 py-3 sm:px-5 lg:px-6">
        <button
          type="button"
          className="rounded-lg p-2 text-[var(--staff-muted)] transition-colors hover:bg-[var(--staff-cream)] hover:text-[var(--staff-ink)] md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="min-w-0 shrink">
          <p className="truncate text-sm font-semibold text-[var(--staff-ink)] sm:text-base">
            <span className="md:hidden">{COMPANY.shortName}</span>
            <span className="hidden md:inline">{COMPANY.name}</span>
          </p>
        </div>

        <CustomerHeaderSearch className="mx-auto hidden min-w-0 max-w-xl flex-1 md:block" />

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setNewOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--staff-ink)] px-3 py-2 text-sm font-semibold text-white transition hover:bg-black"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New</span>
            </button>
            {newOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Close new menu"
                  onClick={() => setNewOpen(false)}
                />
                <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-[var(--staff-border)] bg-white py-1 shadow-lg">
                  {canWriteCustomers ? (
                    <Link
                      href="/dashboard/customers/create"
                      className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                      onClick={closeMenus}
                    >
                      Customer
                    </Link>
                  ) : null}
                  <Link
                    href="/dashboard/contracts"
                    className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={closeMenus}
                  >
                    Contracts
                  </Link>
                  <Link
                    href="/dashboard/orders"
                    className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={closeMenus}
                  >
                    Invoices
                  </Link>
                </div>
              </>
            )}
          </div>

          <NotificationBell variant="light" />

          <Link
            href="/dashboard/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--staff-cream)] text-xs font-bold text-[var(--staff-ink)] ring-1 ring-[var(--staff-border)] transition hover:ring-brand-orange"
            title="Settings"
            aria-label="Account settings"
          >
            {initials}
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="hidden rounded-lg p-2 text-[var(--staff-muted)] transition-colors hover:bg-[var(--staff-cream)] hover:text-[var(--staff-ink)] sm:inline-flex"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <CustomerHeaderSearch
        className="border-t border-[var(--staff-border)] px-3 py-2 md:hidden"
        inputClassName="w-full rounded-xl border border-[var(--staff-border)] bg-white py-2 pl-10 pr-3 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
      />

      {mobileOpen && (
        <div className="border-t border-[var(--staff-border)] bg-[var(--staff-surface)] md:hidden max-h-[min(70dvh,calc(100dvh-7.5rem))] overflow-y-auto overscroll-contain">
          <nav className="flex flex-col gap-5 px-4 pb-4 pt-4">
            <Link
              href="/dashboard"
              className={`rounded-lg px-3 py-2.5 text-sm font-medium ${
                pathname === "/dashboard"
                  ? "bg-[var(--staff-ink)] text-white"
                  : "text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
              }`}
              onClick={closeMenus}
            >
              Home
            </Link>
            {visibleSections.map((section) => (
              <div key={section.label}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                  {section.label}
                </p>
                <div className="flex flex-col gap-1">
                  {section.items.map((item) => (
                    <NavItemGroup
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      variant="sidebar"
                      onNavigate={closeMenus}
                    />
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                closeMenus();
                handleLogout();
              }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
